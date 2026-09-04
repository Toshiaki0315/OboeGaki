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

/// Ollama が動いているか。
pub fn available(port: u16) -> bool {
    request(port, "GET", "/api/tags", None, PROBE_TIMEOUT, |_| true).is_ok()
}

/// 入っているモデルの名前。動いていなければ空。
pub fn models(port: u16) -> Vec<String> {
    let Ok(body) = request(port, "GET", "/api/tags", None, PROBE_TIMEOUT, |_| true) else {
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
    let Ok(body) = request(port, "GET", "/api/ps", None, PROBE_TIMEOUT, |_| true) else {
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
    request(
        port,
        "POST",
        "/api/generate",
        Some(&body),
        timeout,
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

/// モデルをメモリから降ろす（ADR-0025 追記）。
///
/// 中身の無い生成に `keep_alive: 0` を付けると、Ollama は答えずに降ろす。
/// **載っていなければ通信もしない**（走っている生成を壊さない）。
pub fn unload(port: u16, model: &str) -> Result<(), LlmError> {
    if !is_loaded(port, model) {
        return Ok(());
    }
    let body = serde_json::json!({ "model": model, "keep_alive": 0 }).to_string();
    request(
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
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
    mut on_line: impl FnMut(&str) -> bool,
) -> Result<String, LlmError> {
    let address = format!("{HOST}:{port}");
    let stream = TcpStream::connect(&address).map_err(|_| LlmError::NotRunning)?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();
    let mut stream = stream;

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
    let status = read_status(&mut reader)?;
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
        // take で 1 行の長さを抑える（read_line は改行が来るまで無制限に読む）
        match reader.by_ref().take(MAX_LINE_BYTES).read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => return Err(failed(error)),
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
fn http_failure(status: u16, reader: &mut BufReader<TcpStream>) -> String {
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

fn read_status(reader: &mut BufReader<TcpStream>) -> Result<u16, LlmError> {
    let mut line = String::new();
    reader.read_line(&mut line).map_err(failed)?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| LlmError::Failed("応答が読めない".to_string()))?;
    // ヘッダは読み飛ばす（本文の始まりまで）
    loop {
        let mut header = String::new();
        match reader.read_line(&mut header) {
            Ok(0) => break,
            Ok(_) if header.trim().is_empty() => break,
            Ok(_) => {}
            Err(error) => return Err(failed(error)),
        }
    }
    Ok(status)
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
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    /// Ollama の代役。渡した応答をそのまま返し、受け取った本文を知らせる。
    fn stub(response: &'static str) -> (u16, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for stream in listener.incoming().take(1) {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                let mut length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                    request.push_str(&line);
                    if line.trim().is_empty() {
                        break;
                    }
                }
                let mut body = vec![0u8; length];
                reader.read_exact(&mut body).ok();
                request.push_str(&String::from_utf8_lossy(&body));
                let _ = sender.send(request);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (port, receiver)
    }

    const OK_TAGS: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n\
        {\"models\":[{\"name\":\"gemma3:4b\"},{\"name\":\"qwen3:8b\"}]}\n";

    #[test]
    fn test_available_動いていれば真() {
        let (port, _received) = stub(OK_TAGS);
        assert!(available(port));
    }

    #[test]
    fn test_available_動いていなければ偽() {
        // 誰も居ないポート。**押してから断らない**ための確認
        assert!(!available(1));
    }

    #[test]
    fn test_models_入っているモデルを返す() {
        let (port, _received) = stub(OK_TAGS);
        assert_eq!(models(port), vec!["gemma3:4b", "qwen3:8b"]);
    }

    #[test]
    fn test_generate_流れてきたぶんを渡しながら組み立てる() {
        let response = "HTTP/1.1 200 OK\r\n\r\n\
            {\"response\":\"これは\"}\n{\"response\":\"答え\"}\n{\"done\":true}\n";
        let (port, received) = stub(response);
        let mut pieces = Vec::new();
        let answer = generate(
            Generation {
                port,
                model: "gemma3:4b",
                prompt: "こんにちは",
                context: 8192,
                timeout: Duration::from_secs(5),
                keep_alive: "5m",
            },
            |piece| pieces.push(piece.to_string()),
            || false,
        )
        .unwrap();

        assert_eq!(answer, "これは答え");
        assert_eq!(pieces, vec!["これは", "答え"]); // 黙って待たせない
        let sent = received.recv().unwrap();
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
        let response = "HTTP/1.1 200 OK\r\n\r\n\
            {\"response\":\"これは\"}\n{\"response\":\"答え\"}\n{\"response\":\"です\"}\n";
        let (port, _received) = stub(response);
        let seen = std::cell::Cell::new(0);
        let mut pieces = Vec::new();

        let answer = generate(
            Generation {
                port,
                model: "gemma3:4b",
                prompt: "こんにちは",
                context: 8192,
                timeout: Duration::from_secs(5),
                keep_alive: "5m",
            },
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
        let response = "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n\
            {\"error\":\"model \\\"gemma3:4b\\\" not found, try pulling it first\"}";
        let (port, _received) = stub(response);
        let error = generate(
            Generation {
                port,
                model: "gemma3:4b",
                prompt: "p",
                context: 8192,
                timeout: Duration::from_secs(5),
                keep_alive: "5m",
            },
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
        let error = generate(
            Generation {
                port: 1,
                model: "m",
                prompt: "p",
                context: 8192,
                timeout: Duration::from_secs(1),
                keep_alive: "5m",
            },
            |_| {},
            || false,
        )
        .unwrap_err();
        assert_eq!(error, LlmError::NotRunning);
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
                model: model,
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
