// macOS 27 の `fm` コマンド（Apple の Foundation Models。ADR-0071）。
//
// アシスタントと議事録の頼み先を Ollama と選べるようにする。`fm respond "<頼み>"` が
// 答えを標準出力に書くので、子プロセスで呼んで読む（transcribe.rs と同じ形）。
// **既定の端末内モデルだけを使う** — `--model pcc`（Private Cloud Compute）はノートが
// この Mac の外へ出るので渡さない（ADR-0025「外へ出ない」をここでも守る）。
//
// 失敗は llm.rs と同じ LlmError で返す（画面は頼み先によらず同じ言葉で受ける）。
// Tauri は知らない（T3）。

use crate::llm::LlmError;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// `fm` の置き場の候補。GUI のアプリは PATH を引き継がないので、決まった場所を見る
const CANDIDATES: [&str; 2] = ["/usr/bin/fm", "/usr/local/bin/fm"];

/// 端末内モデルの窓は小さい（4K トークン前後）。議事録の区切りはこの字数までにする
/// （Ollama の 8,000 字では 1 区切りが窓に収まらない）
pub const MINUTES_CHUNK_CHARS: usize = 2_000;

/// 「止める」と子プロセスの終わりを見る間隔
const POLL: Duration = Duration::from_millis(100);

/// 候補のうち最初にある `fm`。無ければ None（macOS 26 まで）
pub fn find_in(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

/// この Mac の `fm`
pub fn path() -> Option<PathBuf> {
    find_in(&CANDIDATES)
}

/// `fm` が使えるか（メニューに出すか・押す前に断るかを決める）
pub fn available() -> bool {
    path().is_some()
}

/// 1 回頼む。流れてきたぶんは `on_chunk` へ渡す。`should_stop` が真になったら子プロセスを
/// 止め、そこまでに受け取ったぶんを返す（Ollama の「止める」と同じ）。
/// `timeout` は Ollama と同じく**無通信の猶予**（届き続ける限り待つ）
pub fn respond(
    fm: &Path,
    prompt: &str,
    timeout: Duration,
    mut on_chunk: impl FnMut(&str),
    should_stop: impl Fn() -> bool,
) -> Result<String, LlmError> {
    // 頼みは 1 つの引数で渡す。頭が `-` だと旗と読まれるが、頼み方（llm.rs・minutes.rs）は
    // どれも決まった日本語の文で始まる
    let mut child = Command::new(fm)
        .arg("respond")
        .arg(prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| LlmError::NotRunning)?;
    let (Some(mut stdout), Some(mut stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LlmError::Failed("fm の出力を受け取れません".into()));
    };
    // 読むのは別の糸で。読み取りで止まっている間も「止める」と時間切れを見られるように
    let (pieces, received) = mpsc::channel::<Vec<u8>>();
    let reader = std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = stdout.read(&mut buffer) {
            if n == 0 || pieces.send(buffer[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });

    let mut answer = String::new();
    // 多バイト文字の途中で切れたぶん。次に届いたものと合わせて字にする
    let mut pending: Vec<u8> = Vec::new();
    let mut last_heard = Instant::now();
    loop {
        if should_stop() {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(answer);
        }
        if last_heard.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(LlmError::TimedOut);
        }
        match received.recv_timeout(POLL.min(timeout)) {
            Ok(bytes) => {
                last_heard = Instant::now();
                pending.extend_from_slice(&bytes);
                let whole = match std::str::from_utf8(&pending) {
                    Ok(text) => text.len(),
                    // 途中で切れているだけなら、読めるところまで
                    Err(error) if error.error_len().is_none() => error.valid_up_to(),
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(LlmError::Failed("応答が UTF-8 ではありません".into()));
                    }
                };
                if whole > 0 {
                    let rest = pending.split_off(whole);
                    let text = String::from_utf8(std::mem::replace(&mut pending, rest))
                        .map_err(|_| LlmError::Failed("応答が UTF-8 ではありません".into()))?;
                    on_chunk(&text);
                    answer.push_str(&text);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = reader.join();
    let status = child
        .wait()
        .map_err(|error| LlmError::Failed(error.to_string()))?;
    let stderr = errors.join().unwrap_or_default();
    if status.success() {
        Ok(answer)
    } else {
        let reason = stderr.trim();
        Err(LlmError::Failed(if reason.is_empty() {
            format!("fm が失敗しました（{status}）")
        } else {
            reason.to_string()
        }))
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// 偽の `fm`（シェルのスクリプト）を置く。本物の macOS 27 が無くても約束を試せる
    fn fake(dir: &tempfile::TempDir, script: &str) -> PathBuf {
        let path = dir.path().join("fm");
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    const LONG: Duration = Duration::from_secs(10);

    #[test]
    fn test_respond_に頼みを1つの引数で渡し_答えを返す() {
        let dir = tempfile::tempdir().unwrap();
        // 受け取った引数を 1 行ずつ答える
        let fm = fake(&dir, r#"for a in "$@"; do printf '%s\n' "$a"; done"#);
        let answer = respond(&fm, "要約して\n\n# 会議", LONG, |_| {}, || false).unwrap();
        assert_eq!(answer, "respond\n要約して\n\n# 会議\n");
    }

    #[test]
    fn test_外へ出るモデルは頼まない() {
        // `--model pcc` はノートが Apple のクラウドへ出る（ADR-0071）
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, r#"printf '%s ' "$@""#);
        let answer = respond(&fm, "p", LONG, |_| {}, || false).unwrap();
        assert!(!answer.contains("--model"), "{answer}");
        assert!(!answer.contains("pcc"), "{answer}");
    }

    #[test]
    fn test_流れてきたぶんを渡しながら組み立てる() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, "printf 'これは'; sleep 0.3; printf '答え'");
        let mut pieces = Vec::new();
        let answer = respond(
            &fm,
            "p",
            LONG,
            |piece| pieces.push(piece.to_string()),
            || false,
        )
        .unwrap();
        assert_eq!(answer, "これは答え");
        assert_eq!(pieces.concat(), "これは答え");
        assert!(pieces.len() >= 2, "まとめて届いた: {pieces:?}"); // 黙って待たせない
    }

    #[test]
    fn test_文字の途中で間が空いても字が欠けない() {
        // 「あ」は E3 81 82。1 バイト目だけ先に出してから黙る
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, r"printf '\343'; sleep 0.3; printf '\201\202い'");
        let answer = respond(&fm, "p", LONG, |_| {}, || false).unwrap();
        assert_eq!(answer, "あい");
    }

    #[test]
    fn test_失敗したら標準エラーの言い分ごと返す() {
        // Apple Intelligence が切ってある・窓に収まらない、などはここに出る
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, "echo 'Apple Intelligence is not enabled' >&2; exit 1");
        let error = respond(&fm, "p", LONG, |_| {}, || false).unwrap_err();
        assert_eq!(
            error,
            LlmError::Failed("Apple Intelligence is not enabled".into())
        );
    }

    #[test]
    fn test_fm_が無ければ_not_running() {
        let error = respond(Path::new("/無い/fm"), "p", LONG, |_| {}, || false).unwrap_err();
        assert_eq!(error, LlmError::NotRunning);
    }

    #[test]
    fn test_止めたらすぐ戻り_受け取ったぶんを返し_子プロセスも止める() {
        // 時刻で止めない: 新しく置いた実行ファイルは初回の起動に macOS の検査で 1 秒近く
        // かかることがある。1 つ受け取ったら止める（llm.rs の同名のテストと同じ）
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("まだ動いている");
        let fm = fake(
            &dir,
            &format!("printf '途中'; sleep 2; touch '{}'", marker.display()),
        );
        let seen = std::cell::Cell::new(None::<Instant>);
        let answer = respond(
            &fm,
            "p",
            LONG,
            |_| seen.set(Some(Instant::now())),
            || seen.get().is_some(),
        )
        .unwrap();
        assert_eq!(answer, "途中");
        let stopped = seen.get().unwrap().elapsed();
        assert!(stopped < Duration::from_secs(1), "{stopped:?}");
        std::thread::sleep(Duration::from_millis(2500));
        assert!(!marker.exists(), "止めたあとも子プロセスが動き続けた");
    }

    #[test]
    fn test_黙ったまま時間を過ぎたら時間切れ() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, "sleep 5");
        let started = Instant::now();
        let error = respond(&fm, "p", Duration::from_millis(300), |_| {}, || false).unwrap_err();
        assert_eq!(error, LlmError::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn test_置き場は候補の最初にあるもの() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake(&dir, "true");
        let found = find_in(&["/無い/fm", fm.to_str().unwrap()]);
        assert_eq!(found, Some(fm));
        assert_eq!(find_in(&["/無い/fm"]), None);
    }

    /// 本物の `fm` に通す（macOS 27 で手で回す）:
    /// `cargo test fm::tests::test_本物 -- --ignored --nocapture`
    #[test]
    #[ignore = "macOS 27 の fm と Apple Intelligence が要る"]
    fn test_本物の_fm_で要約できる() {
        let fm = path().expect("fm が無い（macOS 27 から）");
        let started = Instant::now();
        let mut pieces = 0;
        let answer = respond(
            &fm,
            &crate::llm::prompt_for("summary", "覚書", "覚書は Markdown のエディタです。"),
            Duration::from_secs(120),
            |_| pieces += 1,
            || false,
        )
        .expect("答えが返らなかった");
        println!(
            "{:?} / {} 文字 / {pieces} 回に分けて届いた",
            started.elapsed(),
            answer.chars().count()
        );
        assert!(!answer.trim().is_empty());
    }
}
