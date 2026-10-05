// ローカルLLM（TASKS 4-8 / ADR-0025 の Tauri 版）。
//
// **送り先は `127.0.0.1` に固定。** ここだけは設定でも変えられない
// （外へ出ないことがこの機能の前提）。ポートは変えられるが、それは
// 「同じ機械の別の窓口」を指すだけで、送り先は変わらない。
//
// **依存を増やさない。** 相手は手元の HTTP なので、標準ライブラリの
// TcpStream で足りる（参照実装が urllib で済ませたのと同じ判断）。
// 依存を足さない代わりに、HTTP の読み書きはここに閉じ込める。
//
// WebView 非依存（T3）。Tauri のことは知らず、流れてきた答えは
// コールバックで呼び出し側へ渡す。
//
// **通信の口は差し替えられる**（9-5）。繋ぎ方（Connect）と読み書き（Wire）を分け、
// 本番は TcpStream、テストはメモリの代役を使う — 通信の許されない環境（sandbox の
// CI など）でもテストが回る。公開の関数は本番の口（Tcp）で `_on` を呼ぶだけ。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// **変えられない送り先。** 設定に出さない（ADR-0025 決定 3）。
pub const HOST: &str = "127.0.0.1";
/// 居るかの確認は待ちを引きずらない（起動時に窓を固めない）。
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, PartialEq)]
pub enum LlmError {
    /// 動いていない（入れ方を案内する）。
    NotRunning,
    /// 待っても答えが返らない。**NotRunning と混ぜない** — 動いているのに
    /// 「動いているか確かめてください」は嘘になる。
    TimedOut,
    Failed(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRunning => write!(formatter, "not-running"),
            Self::TimedOut => write!(formatter, "timed-out"),
            Self::Failed(message) => write!(formatter, "failed: {message}"),
        }
    }
}

/// 読み書きの口（9-5）。読み取りの時間切れは「まだ届いていない」（WouldBlock /
/// TimedOut）として返すこと — その区切りごとに「止める」と無通信の時間を見ている
pub trait Wire: Read + Write {
    fn set_timeouts(&self, read: Duration, write: Duration);
}

impl Wire for TcpStream {
    fn set_timeouts(&self, read: Duration, write: Duration) {
        self.set_read_timeout(Some(read)).ok();
        self.set_write_timeout(Some(write)).ok();
    }
}

/// 繋ぎ方（9-5）。address は常に `127.0.0.1:<port>`（HOST は変えられない）
pub trait Connect {
    type Wire: Wire;
    fn connect(&self, address: &str) -> std::io::Result<Self::Wire>;
}

/// 本番の口: 同じ機械の TCP
pub struct Tcp;

impl Connect for Tcp {
    type Wire = TcpStream;
    fn connect(&self, address: &str) -> std::io::Result<TcpStream> {
        TcpStream::connect(address)
    }
}

/// Ollama が動いているか。
pub fn available(port: u16) -> bool {
    available_on(&Tcp, port)
}

pub fn available_on(net: &impl Connect, port: u16) -> bool {
    request(net, port, "GET", "/api/tags", None, PROBE_TIMEOUT, |_| true).is_ok()
}

/// 入っているモデルの名前。動いていなければ空。
pub fn models(port: u16) -> Vec<String> {
    models_on(&Tcp, port)
}

pub fn models_on(net: &impl Connect, port: u16) -> Vec<String> {
    let Ok(body) = request(net, port, "GET", "/api/tags", None, PROBE_TIMEOUT, |_| true) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) else {
        return Vec::new();
    };
    parsed["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// そのモデルが今メモリに載っているか（`/api/ps`）。
///
/// 載っていなければ「読み込んでいます…」と言えるようにするためのもの。
/// **6 分の沈黙は壊れて見える**（ADR-0025 追記）。
pub fn is_loaded(port: u16, model: &str) -> bool {
    is_loaded_on(&Tcp, port, model)
}

pub fn is_loaded_on(net: &impl Connect, port: u16, model: &str) -> bool {
    let Ok(body) = request(net, port, "GET", "/api/ps", None, PROBE_TIMEOUT, |_| true) else {
        return false;
    };
    body.contains(model)
}

/// 1 回の生成の注文。**まとめて渡す** — 数が増えると呼ぶ側で順番を
/// 取り違える（port と context がどちらも数）。
pub struct Generation<'a> {
    pub port: u16,
    pub model: &'a str,
    pub prompt: &'a str,
    pub context: u32,
    pub timeout: Duration,
    /// 答えたあとモデルをメモリに残す長さ（`"5m"` など）
    pub keep_alive: &'a str,
}

/// 生成する。流れてきたぶんは `on_chunk` へ渡す（**黙って待たせない**）。
/// `should_stop` が真を返したら、そこまでで切り上げる（L-1「止める」）。
pub fn generate(
    order: Generation<'_>,
    on_chunk: impl FnMut(&str),
    should_stop: impl Fn() -> bool,
) -> Result<String, LlmError> {
    generate_on(&Tcp, order, on_chunk, should_stop)
}

pub fn generate_on(
    net: &impl Connect,
    order: Generation<'_>,
    mut on_chunk: impl FnMut(&str),
    should_stop: impl Fn() -> bool,
) -> Result<String, LlmError> {
    let Generation {
        port,
        model,
        prompt,
        context,
        timeout,
        keep_alive,
    } = order;
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": true,
        "keep_alive": keep_alive,
        "options": { "num_ctx": context },
    })
    .to_string();
    let mut answer = String::new();
    request_until(
        net,
        port,
        "POST",
        "/api/generate",
        Some(&body),
        timeout,
        &should_stop,
        |line| {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(piece) = parsed["response"].as_str() {
                    answer.push_str(piece);
                    on_chunk(piece);
                }
            }
            // **受け取ったぶんは捨てない。** 途中まででも読める答えが
            // 出ていることがある（L-1「止める」）
            !should_stop()
        },
    )?;
    Ok(answer)
}

/// 画像に書かれた文字をそのまま書き起こす頼み方（ADR-0027 決定 3。
/// 参照実装 core/ocr.py と同じ文）。
pub const OCR_PROMPT: &str = "この画像に書かれている文字を、**そのまま**書き起こしてください。\
説明・要約・訳は不要です。文字が無ければ何も書かないでください。";

/// 画像から文字を読む（ADR-0027 決定 1 の「手元の LLM」側）。
///
/// **モデルは設定のもの。** 画像を見られないモデルは空か説明を返すので、
/// 空なら「読めなかった」と扱う（呼び出し側）。答えは一度に受ける —
/// 読み取りは流しながら見せるものではない。
pub fn read_image(order: Generation<'_>, image: &[u8]) -> Result<String, LlmError> {
    read_image_on(&Tcp, order, image)
}

pub fn read_image_on(
    net: &impl Connect,
    order: Generation<'_>,
    image: &[u8],
) -> Result<String, LlmError> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(image);
    let body = serde_json::json!({
        "model": order.model,
        "prompt": order.prompt,
        "images": [encoded],
        "stream": false,
        "keep_alive": order.keep_alive,
        "options": { "num_ctx": order.context },
    })
    .to_string();
    let collected = request(
        net,
        order.port,
        "POST",
        "/api/generate",
        Some(&body),
        order.timeout,
        |_| true,
    )?;
    let parsed = serde_json::from_str::<serde_json::Value>(collected.lines().next().unwrap_or(""))
        .map_err(|error| LlmError::Failed(format!("答えが読めない: {error}")))?;
    Ok(parsed["response"].as_str().unwrap_or("").trim().to_string())
}

/// モデルをメモリから降ろす（ADR-0025 追記）。
///
/// 中身の無い生成に `keep_alive: 0` を付けると、Ollama は答えずに降ろす。
/// **載っていなければ通信もしない**（走っている生成を壊さない）。
pub fn unload(port: u16, model: &str) -> Result<(), LlmError> {
    unload_on(&Tcp, port, model)
}

pub fn unload_on(net: &impl Connect, port: u16, model: &str) -> Result<(), LlmError> {
    if !is_loaded_on(net, port, model) {
        return Ok(());
    }
    let body = serde_json::json!({ "model": model, "keep_alive": 0 }).to_string();
    request(
        net,
        port,
        "POST",
        "/api/generate",
        Some(&body),
        PROBE_TIMEOUT,
        |_| true,
    )?;
    Ok(())
}

/// 1 回の応答で受け取る上限。壊れたサービスが改行なしのバイト列や
/// 無限のチャンクを流し続けても、メモリと時間を食い尽くさない
///（レビュー 2026-09-04）。
const MAX_LINE_BYTES: u64 = 1024 * 1024; // 1 行 1MB
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024; // 全体 8MB
/// 全体の締切。read_timeout は「無通信の猶予」なので、細切れに届き
/// 続ける限りループは終わらない。応答全体はこの時間で打ち切る
const MAX_TOTAL: Duration = Duration::from_secs(30 * 60);

/// HTTP の 1 往復。行が届くたびに `on_line` を呼び、本文全体も返す。
/// `on_line` が `false` を返したら、そこで読むのをやめる。
fn request(
    net: &impl Connect,
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
    on_line: impl FnMut(&str) -> bool,
) -> Result<String, LlmError> {
    request_until(net, port, method, path, body, timeout, &|| false, on_line)
}

/// 読み取りの待ちの区切り。この間隔で「止める」と無通信の時間を確かめる（24-5）
const POLL: Duration = Duration::from_millis(200);

/// `request` に「止める」を足したもの。**何も届かない間も止められる** — 以前は読み
/// 取りの待ちを生成の時間切れ（1〜120 分）にしたまま、止める印を行が届いたときに
/// しか見なかったので、モデルの読み込み中や長い文を読んでいる間は止まらなかった
/// （24-5）。止めたら、そこまでに受け取ったぶんを返す
#[allow(clippy::too_many_arguments)] // 1 往復の注文そのもの。まとめると呼び手が読みにくい
fn request_until(
    net: &impl Connect,
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
    should_stop: &dyn Fn() -> bool,
    mut on_line: impl FnMut(&str) -> bool,
) -> Result<String, LlmError> {
    let address = format!("{HOST}:{port}");
    let mut stream = net.connect(&address).map_err(|_| LlmError::NotRunning)?;
    // 読み取りは短く区切り、区切りごとに止める印と無通信の時間（timeout）を見る
    stream.set_timeouts(POLL.min(timeout), timeout);

    let payload = body.unwrap_or("");
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|()| stream.write_all(payload.as_bytes()))
        .and_then(|()| stream.flush())
        .map_err(failed)?;

    let mut reader = BufReader::new(stream);
    let Some(status) = read_status(&mut reader, timeout, should_stop)? else {
        return Ok(String::new()); // 応答の頭を待つ間に止めた
    };
    if !(200..300).contains(&status) {
        return Err(LlmError::Failed(http_failure(status, &mut reader)));
    }

    let mut collected = String::new();
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > MAX_TOTAL {
            return Err(LlmError::Failed("応答が長すぎるため打ち切った".into()));
        }
        let mut line = String::new();
        match read_line_waiting(&mut reader, &mut line, timeout, should_stop)? {
            None => break, // 止めた。受け取ったぶんは返す
            Some(0) => break,
            Some(_) => {}
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        // chunked のときは長さの行が挟まる。JSON でない行は数えない
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }
        let keep_reading = on_line(trimmed);
        if collected.len() + trimmed.len() < MAX_BODY_BYTES {
            collected.push_str(trimmed);
            collected.push('\n');
        }
        if !keep_reading {
            break;
        }
    }
    Ok(collected)
}

/// 2xx 以外の本文から Ollama の言い分（`{"error":"…"}`）を拾う。
/// 「HTTP 404」だけでは、設定のモデル名の打ち間違いに気づけない。
fn http_failure(status: u16, reader: &mut BufReader<impl Read>) -> String {
    let mut body = String::new();
    let _ = reader
        .by_ref()
        .take(MAX_LINE_BYTES)
        .read_to_string(&mut body);
    // chunked のときは長さの行が挟まるので、JSON の行だけを見る
    let detail = body.lines().find_map(|line| {
        let line = line.trim();
        if !line.starts_with('{') {
            return None;
        }
        serde_json::from_str::<serde_json::Value>(line)
            .ok()?
            .get("error")?
            .as_str()
            .map(str::to_string)
    });
    match detail {
        Some(message) => format!("HTTP {status}: {message}"),
        None => format!("HTTP {status}"),
    }
}

/// 1 行を読む。区切り（POLL）ごとに止める印と無通信の時間を見る。止めたら `None`、
/// 無通信が `idle` を超えたら時間切れ。バイト列で受けて最後に文字列にする —
/// `read_line` は区切りが多バイト文字の途中に来ると、読めたぶんを捨てるので字が欠ける
fn read_line_waiting(
    reader: &mut BufReader<impl Read>,
    line: &mut String,
    idle: Duration,
    should_stop: &dyn Fn() -> bool,
) -> Result<Option<usize>, LlmError> {
    let started = std::time::Instant::now();
    let mut bytes = Vec::new();
    loop {
        // take で 1 行の長さを抑える（区切りをまたいでも合わせて MAX_LINE_BYTES まで）
        let room = MAX_LINE_BYTES.saturating_sub(bytes.len() as u64);
        match reader.by_ref().take(room).read_until(b'\n', &mut bytes) {
            Ok(_) => break,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if should_stop() {
                    return Ok(None);
                }
                if started.elapsed() >= idle {
                    return Err(LlmError::TimedOut);
                }
            }
            Err(error) => return Err(failed(error)),
        }
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| LlmError::Failed("応答が UTF-8 ではありません".into()))?;
    line.push_str(&text);
    Ok(Some(text.len()))
}

fn read_status(
    reader: &mut BufReader<impl Read>,
    idle: Duration,
    should_stop: &dyn Fn() -> bool,
) -> Result<Option<u16>, LlmError> {
    let mut line = String::new();
    if read_line_waiting(reader, &mut line, idle, should_stop)?.is_none() {
        return Ok(None);
    }
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| LlmError::Failed("応答が読めない".to_string()))?;
    // ヘッダは読み飛ばす（本文の始まりまで）
    loop {
        let mut header = String::new();
        match read_line_waiting(reader, &mut header, idle, should_stop)? {
            None => return Ok(None),
            Some(0) => break,
            Some(_) if header.trim().is_empty() => break,
            Some(_) => {}
        }
    }
    Ok(Some(status))
}

fn failed(error: std::io::Error) -> LlmError {
    match error.kind() {
        // **時間切れは分ける。** 動いているのに「動いているか確かめて
        // ください」は嘘になる（ADR-0025 追記）
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => LlmError::TimedOut,
        _ => LlmError::Failed(error.to_string()),
    }
}

/// 読ませる本文の組み立て（GUI 非依存）。
///
/// **どの仕事も「渡した資料だけを見る」**（ADR-0025）。外の知識で
/// 補わせない — 根拠を確かめられない答えは使えない。
pub fn prompt_for(task: &str, title: &str, body: &str) -> String {
    let instruction = match task {
        // **短く頼むだけでは足りない。** 小さいモデルは要約を頼まれても
        // 評価を書く（実機報告 2026-09-04: 「素晴らしい！非常に詳細で…」）。
        // 書かないでほしいものを名指しする
        "summary" => {
            "次のノートを日本語で 3 行以内にまとめてください。\n\
             **評価や感想は書かず**、書かれている事実だけを短く並べてください。"
        }
        "review" => {
            "次のノートを読んで、直したほうがよいところを箇条書きで挙げてください。\n\
             **直した文は書かず、指摘だけ**にしてください。"
        }
        "questions" => "次のノートを読んで、書き足すとよい点を質問の形で 3 つ挙げてください。",
        _ => "次のノートについて答えてください。",
    };
    format!(
        "{instruction}\n\n**渡したノートだけを見て答えてください**（外の知識で補わない）。\n\n\
         # {title}\n\n{body}\n"
    )
}

/// vault 全体への質問（L-2 / ADR-0025）。材料は**呼ぶ側が選んで渡す**。
///
/// **モデルに探させない。** 探す道具（索引）はこちら側にあり、どのノートを
/// 見たかを画面に出せるのもこちらだけ。出典を作文させない。
/// 材料が無ければ `None`（材料の無い問いに答えさせると作り話が出る）。
pub fn question_prompt(question: &str, sources: &[(String, String)]) -> Option<String> {
    let asked = question.trim();
    if asked.is_empty() || sources.is_empty() {
        return None;
    }
    let excerpts = sources
        .iter()
        .map(|(title, body)| format!("## {title}\n{body}"))
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(format!(
        "あなたは日本語で答える調べ物の助手です。**次の抜粋だけを使って**質問に\
         答えてください。抜粋に書かれていないことは推測せず、\
         「ノートには書かれていません」と答えてください。\
         どのノートに基づくかを本文中で題名で示してください。\n\n\
         ---\n{excerpts}\n---\n\n質問: {asked}"
    ))
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// 偽の Ollama が流すものの 1 区切り
    enum Step {
        Bytes(Vec<u8>),
        /// その回数だけ「まだ何も届いていない」（読み取りの時間切れ）を返す
        Pause(usize),
        /// ずっと何も返さない（モデルの読み込み中・長い文を読んでいる間）
        Hang,
    }

    /// 1 回の「まだ届いていない」の間。本物の読み取りの区切り（POLL）の代わり
    const PAUSE: Duration = Duration::from_millis(20);

    /// 偽の繋ぎ先（9-5）。**ループバックに待ち受けを立てずに** Ollama の代役をする —
    /// 通信の許されない環境（sandbox の CI など）でもテストが回る
    #[derive(Clone, Default)]
    struct FakeNet {
        steps: Arc<Mutex<VecDeque<Step>>>,
        sent: Arc<Mutex<Vec<u8>>>,
        address: Arc<Mutex<Option<String>>>,
        refuse: bool,
    }

    impl FakeNet {
        fn answering(steps: Vec<Step>) -> Self {
            let net = Self::default();
            *net.steps.lock().unwrap() = steps.into();
            net
        }
        fn replying(response: &str) -> Self {
            Self::answering(vec![Step::Bytes(response.as_bytes().to_vec())])
        }
        /// 誰も待ち受けていない（Ollama が動いていない）
        fn refusing() -> Self {
            Self {
                refuse: true,
                ..Self::default()
            }
        }
        /// 送られてきた頼み（頭と本文）
        fn sent(&self) -> String {
            String::from_utf8_lossy(&self.sent.lock().unwrap()).into_owned()
        }
    }

    struct FakeWire(FakeNet);

    impl Read for FakeWire {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let mut steps = self.0.steps.lock().unwrap();
            match steps.pop_front() {
                None => Ok(0),
                Some(Step::Bytes(mut bytes)) => {
                    let n = bytes.len().min(buf.len());
                    buf[..n].copy_from_slice(&bytes[..n]);
                    if n < bytes.len() {
                        steps.push_front(Step::Bytes(bytes.split_off(n)));
                    }
                    Ok(n)
                }
                Some(Step::Pause(left)) => {
                    if left > 1 {
                        steps.push_front(Step::Pause(left - 1));
                    }
                    drop(steps);
                    std::thread::sleep(PAUSE);
                    Err(std::io::ErrorKind::WouldBlock.into())
                }
                Some(Step::Hang) => {
                    steps.push_front(Step::Hang);
                    drop(steps);
                    std::thread::sleep(PAUSE);
                    Err(std::io::ErrorKind::WouldBlock.into())
                }
            }
        }
    }

    impl Write for FakeWire {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.sent.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Wire for FakeWire {
        fn set_timeouts(&self, _read: Duration, _write: Duration) {}
    }

    impl Connect for FakeNet {
        type Wire = FakeWire;
        fn connect(&self, address: &str) -> std::io::Result<FakeWire> {
            if self.refuse {
                return Err(std::io::ErrorKind::ConnectionRefused.into());
            }
            *self.address.lock().unwrap() = Some(address.to_string());
            Ok(FakeWire(self.clone()))
        }
    }

    fn order<'a>(model: &'a str, prompt: &'a str, timeout: Duration) -> Generation<'a> {
        Generation {
            port: 11434,
            model,
            prompt,
            context: 8192,
            timeout,
            keep_alive: "5m",
        }
    }

    const OK_TAGS: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n\
        {\"models\":[{\"name\":\"gemma3:4b\"},{\"name\":\"qwen3:8b\"}]}\n";

    /// 何も届かない間も「止める」が効く（24-5）。以前は止める印を行が届いたときに
    /// しか見ず、読み取りの待ちも生成の時間切れのままだったので、最初の 1 行が来るか
    /// 時間切れになるまで止まらなかった
    #[test]
    fn test_generate_何も届かない間も止めるとすぐ戻る() {
        let net = FakeNet::answering(vec![Step::Hang]);
        let started = std::time::Instant::now();
        let stop_at = started + Duration::from_millis(300);
        let result = generate_on(
            &net,
            order("gemma3:4b", "こんにちは", Duration::from_secs(60)),
            |_| {},
            || std::time::Instant::now() >= stop_at,
        );
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "止めてから戻るまで {:?}",
            started.elapsed()
        );
        assert_eq!(result.unwrap(), "");
    }

    /// 区切りの待ちが多バイト文字の途中に来ても字が欠けない（24-5）。`read_line` は
    /// 途切れたときに UTF-8 として不完全なぶんを捨てるので、バイト列で受ける
    #[test]
    fn test_generate_文字の途中で間が空いても字が欠けない() {
        let whole = "HTTP/1.1 200 OK\r\n\r\n{\"response\":\"あい\"}\n{\"done\":true}\n";
        // 「あ」の 3 バイトの 1 バイト目までを流し、区切りより長く黙ってから残りを流す
        let cut = whole.find('あ').unwrap() + 1;
        let net = FakeNet::answering(vec![
            Step::Bytes(whole.as_bytes()[..cut].to_vec()),
            Step::Pause(3),
            Step::Bytes(whole.as_bytes()[cut..].to_vec()),
        ]);
        let answer = generate_on(
            &net,
            order("gemma3:4b", "こんにちは", Duration::from_secs(5)),
            |_| {},
            || false,
        )
        .unwrap();
        assert_eq!(answer, "あい");
    }

    #[test]
    fn test_generate_黙ったまま時間を過ぎたら時間切れ_動いていないとは言わない() {
        let net = FakeNet::answering(vec![Step::Hang]);
        let error = generate_on(
            &net,
            order("gemma3:4b", "こんにちは", Duration::from_millis(200)),
            |_| {},
            || false,
        )
        .unwrap_err();
        assert_eq!(error, LlmError::TimedOut);
    }

    #[test]
    fn test_送り先は127_0_0_1_の決めたポート() {
        let net = FakeNet::replying(OK_TAGS);
        assert!(available_on(&net, 11500));
        assert_eq!(
            net.address.lock().unwrap().as_deref(),
            Some("127.0.0.1:11500")
        );
    }

    #[test]
    fn test_available_動いていれば真() {
        assert!(available_on(&FakeNet::replying(OK_TAGS), 11434));
    }

    #[test]
    fn test_available_動いていなければ偽() {
        // 誰も居ないポート。**押してから断らない**ための確認
        assert!(!available_on(&FakeNet::refusing(), 11434));
    }

    #[test]
    fn test_models_入っているモデルを返す() {
        assert_eq!(
            models_on(&FakeNet::replying(OK_TAGS), 11434),
            vec!["gemma3:4b", "qwen3:8b"]
        );
    }

    #[test]
    fn test_generate_流れてきたぶんを渡しながら組み立てる() {
        let net = FakeNet::replying(
            "HTTP/1.1 200 OK\r\n\r\n\
            {\"response\":\"これは\"}\n{\"response\":\"答え\"}\n{\"done\":true}\n",
        );
        let mut pieces = Vec::new();
        let answer = generate_on(
            &net,
            order("gemma3:4b", "こんにちは", Duration::from_secs(5)),
            |piece| pieces.push(piece.to_string()),
            || false,
        )
        .unwrap();

        assert_eq!(answer, "これは答え");
        assert_eq!(pieces, vec!["これは", "答え"]); // 黙って待たせない
        let sent = net.sent();
        assert!(
            sent.starts_with("POST /api/generate HTTP/1.1\r\n"),
            "{sent}"
        );
        assert!(sent.contains("\"model\":\"gemma3:4b\""));
        assert!(sent.contains("\"num_ctx\":8192"));
        assert!(sent.contains("\"keep_alive\":\"5m\""));
    }

    #[test]
    fn test_question_prompt_渡した抜粋だけで答えさせる() {
        // vault 全体への質問（L-2）。**モデルに探させない** — 探す道具
        // （索引）はこちら側にあり、どのノートを見たかを画面に出せるのも
        // こちらだけ。出典を作文させない
        let prompt = question_prompt(
            "予算はどうなった？",
            &[
                ("会議".to_string(), "予算は据え置き。".to_string()),
                ("メモ".to_string(), "来期に見直す。".to_string()),
            ],
        )
        .unwrap();

        assert!(prompt.contains("## 会議\n予算は据え置き。"));
        assert!(prompt.contains("## メモ\n来期に見直す。"));
        assert!(prompt.contains("質問: 予算はどうなった？"));
        // 抜粋の外を答えさせない
        assert!(prompt.contains("書かれていません"));
    }

    #[test]
    fn test_question_prompt_材料が無ければ読ませない() {
        // 材料の無い問いに答えさせると作り話が出る。GPU を回す意味もない
        assert!(question_prompt("予算は？", &[]).is_none());
        assert!(question_prompt("  ", &[("会議".into(), "本文".into())]).is_none());
    }

    #[test]
    fn test_generate_止められたら途中で切り上げる() {
        // 「止める」（L-1）。**受け取ったぶんは捨てない** — 途中まででも
        // 読める答えが出ていることがある
        let net = FakeNet::replying(
            "HTTP/1.1 200 OK\r\n\r\n\
            {\"response\":\"これは\"}\n{\"response\":\"答え\"}\n{\"response\":\"です\"}\n",
        );
        let seen = std::cell::Cell::new(0);
        let mut pieces = Vec::new();

        let answer = generate_on(
            &net,
            order("gemma3:4b", "こんにちは", Duration::from_secs(5)),
            |piece| {
                pieces.push(piece.to_string());
                seen.set(seen.get() + 1);
            },
            || seen.get() >= 1, // 1 つ受け取ったら止める
        )
        .unwrap();

        assert_eq!(answer, "これは");
        assert_eq!(pieces, vec!["これは"]);
    }

    #[test]
    fn test_generate_モデルが無いときは404の言い分ごと返す() {
        // 「HTTP 404」だけでは、設定のモデル名の打ち間違いに気づけない
        // （実機で「読み込んでいます…」のまま止まって見えた）
        let net = FakeNet::replying(
            "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n\
            {\"error\":\"model \\\"gemma3:4b\\\" not found, try pulling it first\"}",
        );
        let error = generate_on(
            &net,
            order("gemma3:4b", "p", Duration::from_secs(5)),
            |_| {},
            || false,
        )
        .unwrap_err();
        assert_eq!(
            error,
            LlmError::Failed(
                "HTTP 404: model \"gemma3:4b\" not found, try pulling it first".into()
            )
        );
    }

    #[test]
    fn test_generate_動いていなければ_not_running() {
        let error = generate_on(
            &FakeNet::refusing(),
            order("m", "p", Duration::from_secs(1)),
            |_| {},
            || false,
        )
        .unwrap_err();
        assert_eq!(error, LlmError::NotRunning);
    }

    #[test]
    fn test_read_image_画像を添えて頼み_答えを返す() {
        let net = FakeNet::replying(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n\
             {\"response\":\"読めた文字\",\"done\":true}\n",
        );
        let found = read_image_on(
            &net,
            order("qwen2.5vl", OCR_PROMPT, Duration::from_secs(5)),
            b"hi",
        )
        .expect("読めるはず");
        assert_eq!(found, "読めた文字");
        let sent = net.sent();
        // 画像は base64 で `images` に載せ、答えは一度に受ける（ADR-0027 決定 3）
        assert!(sent.contains("\"images\":[\"aGk=\"]"), "{sent}");
        assert!(sent.contains("\"stream\":false"), "{sent}");
        assert!(sent.contains("そのまま"), "{sent}");
    }

    #[test]
    fn test_read_image_画像を読めないモデルは空を返す() {
        // 説明も何も返さないモデル。**壊れることではない** — 空で知らせる
        let net = FakeNet::replying("HTTP/1.1 200 OK\r\n\r\n{\"response\":\"  \",\"done\":true}\n");
        let found = read_image_on(&net, order("m", OCR_PROMPT, Duration::from_secs(5)), b"hi")
            .expect("空でも読める");
        assert_eq!(found, "");
    }

    #[test]
    fn test_unload_載っていなければ通信もしない() {
        // 走っている生成を壊さない。/api/ps に無ければ降ろしに行かない
        let net = FakeNet::replying("HTTP/1.1 200 OK\r\n\r\n{\"models\":[]}\n");
        unload_on(&net, 11434, "gemma3:4b").unwrap();
        let sent = net.sent();
        assert!(sent.starts_with("GET /api/ps "), "{sent}");
        assert!(!sent.contains("/api/generate"), "{sent}");
    }

    /// **本物の TCP で**代役に通す（9-5 で既定のテストは偽の繋ぎ先にした。TCP の口
    /// そのものはここと本物の Ollama のテストで見る）。ループバックに待ち受けを立てる
    #[test]
    #[ignore = "ループバックに待ち受けを立てる。手で回す: cargo test llm::tests::test_本物の_TCP -- --ignored"]
    fn test_本物の_TCP_で代役に通る() {
        use std::io::BufRead;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                        break;
                    }
                }
                let _ = stream.write_all(OK_TAGS.as_bytes());
            }
        });
        assert_eq!(models(port), vec!["gemma3:4b", "qwen3:8b"]);
    }

    #[test]
    fn test_送り先は127_0_0_1に固定されている() {
        // **ここだけは緩めない**（外へ出ないことがこの機能の前提）
        assert_eq!(HOST, "127.0.0.1");
    }

    /// **本物の Ollama に通す**（動いているときだけ）。
    ///
    /// 参照実装は「作り物のせいで試験をすり抜けた」（LLM 側に画像を
    /// 渡していなかった）と書いている。口の形だけを見る試験では、
    /// 本物の応答が変わったときに気づけない。
    ///
    /// 既定では走らせない（Ollama を入れていない人の `make check` を
    /// 赤くしない）。`cargo test -- --ignored` で通す。
    #[test]
    #[ignore = "本物の Ollama が動いているときだけ"]
    fn test_本物のollamaに通る() {
        const PORT: u16 = 11434;
        assert!(available(PORT), "Ollama が動いていない");
        let found = models(PORT);
        assert!(!found.is_empty(), "モデルが入っていない");
        let model = found
            .iter()
            .find(|name| name.starts_with("gemma3:1b"))
            .or_else(|| found.first())
            .unwrap()
            .clone();

        let mut pieces = 0;
        let started = std::time::Instant::now();
        let answer = generate(
            Generation {
                port: PORT,
                model: &model,
                prompt: &prompt_for("summary", "覚書", "覚書は Markdown のエディタです。"),
                context: 8192,
                timeout: Duration::from_secs(120),
                keep_alive: "1m",
            },
            |_| pieces += 1,
            || false,
        )
        .expect("生成できなかった");
        println!(
            "{model}: {:?} / {} 文字 / {pieces} 回に分けて届いた",
            started.elapsed(),
            answer.chars().count()
        );
        assert!(!answer.trim().is_empty(), "答えが空");
        // **流れてきたぶんを渡している**（黙って待たせない）
        assert!(pieces > 1, "まとめて届いた: {pieces}");
    }

    /// 降ろす道が本当に効くか（ADR-0025 追記）。
    #[test]
    #[ignore = "本物の Ollama が動いているときだけ"]
    fn test_本物のollamaでモデルを降ろせる() {
        const PORT: u16 = 11434;
        assert!(available(PORT), "Ollama が動いていない");
        let model = models(PORT)
            .into_iter()
            .find(|name| name.starts_with("gemma3:1b"))
            .expect("gemma3:1b が要る");

        // 一度読ませて載せる
        generate(
            Generation {
                port: PORT,
                model: &model,
                prompt: "こんにちは",
                context: 2048,
                timeout: Duration::from_secs(120),
                keep_alive: "30m",
            },
            |_| {},
            || false,
        )
        .unwrap();
        assert!(is_loaded(PORT, &model), "載っていない");

        unload(PORT, &model).unwrap();
        // 降りるまで少し待つ（Ollama が llama-server を畳む）
        for _ in 0..20 {
            if !is_loaded(PORT, &model) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(!is_loaded(PORT, &model), "降りていない");
    }

    /// 既定のモデル（gemma3:4b）で、実際のノートくらいの長さを読ませる。
    /// ADR-0025 の実測（12.8 秒／要約 1 本）と並べるため。
    #[test]
    #[ignore = "本物の Ollama が動いているときだけ"]
    fn test_本物のollamaで既定のモデルの速さを測る() {
        const PORT: u16 = 11434;
        let model = "gemma3:4b";
        if !available(PORT) || !models(PORT).iter().any(|name| name == model) {
            eprintln!("{model} が無いので飛ばす");
            return;
        }
        let body = "# 会議メモ\n\n## 決めたこと\n\n- 予算は前年度と同じ\n                    - 日程は 9 月 20 日\n\n## 持ち帰り\n\n- 会場の確認\n"
            .repeat(6);
        let started = std::time::Instant::now();
        let answer = generate(
            Generation {
                port: PORT,
                model,
                prompt: &prompt_for("summary", "会議メモ", &body),
                context: 8192,
                timeout: Duration::from_secs(300),
                keep_alive: "1m",
            },
            |_| {},
            || false,
        )
        .expect("生成できなかった");
        println!(
            "{model}: {:?} / {} 文字",
            started.elapsed(),
            answer.chars().count()
        );
        assert!(!answer.trim().is_empty());
    }

    #[test]
    fn test_prompt_渡した資料だけを見るよう頼む() {
        let prompt = prompt_for("summary", "会議メモ", "本文");
        assert!(prompt.contains("渡したノートだけを見て答えてください"));
        assert!(prompt.contains("# 会議メモ"));
        assert!(prompt.contains("本文"));
    }

    #[test]
    fn test_prompt_要約は感想を書かせない() {
        // 実機報告 2026-09-04: 「素晴らしい！非常に詳細で…」と評価を書き、
        // 3 行にもならなかった（gemma3）。**短く頼むだけでは足りない**
        let prompt = prompt_for("summary", "t", "b");
        assert!(prompt.contains("3 行"));
        assert!(prompt.contains("感想"));
    }

    #[test]
    fn test_prompt_レビューは指摘だけを頼む() {
        // **直しはしない**（本文は書き換えない = T1）
        assert!(prompt_for("review", "t", "b").contains("指摘だけ"));
    }
}
