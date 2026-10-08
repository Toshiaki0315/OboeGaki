// 音声・動画の文字起こし（TASKS 28-1 / ADR-0070）。
//
// 文字起こしそのものは同梱の Swift の実行ファイル（`oboegaki-transcribe`。src-tauri/transcribe/
// main.swift）が macOS 26 の SpeechAnalyzer で行う — Swift からしか呼べないため。ここは
// それを子プロセスで呼び、タブ区切りの行を読んで、進み具合と止めるを受け持つ。Tauri は知らない（T3）。
//
// 実行ファイルとの約束（main.swift の頭と揃える）:
//   duration<TAB>秒 / segment<TAB>秒<TAB>文。終わり方 0 / 2 / 3 / 4 / 5 / 6

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// 同梱の実行ファイルの名前（`Contents/MacOS/` に、おぼえがき本体と並べて置く）
pub const HELPER: &str = "oboegaki-transcribe";

/// 「止める」と子プロセスの終わりを見る間隔
const POLL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    /// 録音の頭からの秒
    pub at: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Duration(f64),
    Segment(Segment),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Transcript {
    /// 録音の長さ（秒）
    pub duration: f64,
    pub segments: Vec<Segment>,
}

impl Transcript {
    /// `[mm:ss] 文` を 1 行ずつ（ノートと議事録の頼みに使う形）
    pub fn lines(&self) -> String {
        self.segments
            .iter()
            .map(|segment| format!("[{}] {}\n", stamp(segment.at), segment.text))
            .collect()
    }
}

/// 失敗の理由（実行ファイルの終わり方と揃える）
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// 同梱の実行ファイルが見つからない・起動できない
    Missing,
    /// macOS 26 未満（終わり方 3）
    OldMacos,
    /// 日本語の言語データが無い（4）
    NoLanguage,
    /// ファイルを読めない（5）
    Unreadable(String),
    /// 文字起こしに失敗（6 ほか）
    Failed(String),
    /// 止めた
    Stopped,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => f.write_str("文字起こしの部品が見つかりません（アプリを入れ直してください）"),
            Self::OldMacos => f.write_str("文字起こしには macOS 26 以降が要ります"),
            Self::NoLanguage => f.write_str(
                "日本語の音声認識の言語データが入っていません（システム設定の「キーボード」→「音声入力」で日本語を入れてください）",
            ),
            Self::Unreadable(reason) => write!(f, "ファイルを読めません: {reason}"),
            Self::Failed(reason) => write!(f, "文字起こしに失敗しました: {reason}"),
            Self::Stopped => f.write_str("文字起こしを止めました"),
        }
    }
}

/// 実行ファイルの 1 行を読む。知らない行・空の文は None
pub fn parse_line(line: &str) -> Option<Event> {
    let mut parts = line.splitn(3, '\t');
    match (parts.next()?, parts.next(), parts.next()) {
        ("duration", Some(seconds), None) => seconds.trim().parse().ok().map(Event::Duration),
        ("segment", Some(seconds), Some(text)) => {
            let at: f64 = seconds.trim().parse().ok()?;
            let text = text.trim();
            (!text.is_empty()).then(|| {
                Event::Segment(Segment {
                    at,
                    text: text.to_string(),
                })
            })
        }
        _ => None,
    }
}

/// 秒を `mm:ss`（1 時間を超えたら `h:mm:ss`）に
pub fn stamp(seconds: f64) -> String {
    let total = seconds.max(0.0) as u64;
    let (hours, minutes, secs) = (total / 3600, total / 60 % 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes:02}:{secs:02}")
    }
}

/// 実行ファイルの置き場（おぼえがき本体の隣）
pub fn helper_beside(exe: &Path) -> PathBuf {
    exe.parent().unwrap_or(Path::new(".")).join(HELPER)
}

/// 今動いているおぼえがきの隣の実行ファイル
pub fn helper_path() -> PathBuf {
    std::env::current_exe()
        .map(|exe| helper_beside(&exe))
        .unwrap_or_else(|_| PathBuf::from(HELPER))
}

/// 終わり方を理由にする
fn failure_of(code: Option<i32>, stderr: String) -> Failure {
    let reason = stderr.trim().to_string();
    match code {
        Some(3) => Failure::OldMacos,
        Some(4) => Failure::NoLanguage,
        Some(5) => Failure::Unreadable(reason),
        Some(2) => Failure::Failed(format!("呼び方が違います: {reason}")),
        _ => Failure::Failed(reason),
    }
}

/// 使えるかを確かめる（macOS 26 か・日本語の言語データがあるか）。何もダウンロードしない
pub fn probe(helper: &Path) -> Result<(), Failure> {
    let output = Command::new(helper)
        .arg("--probe")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| Failure::Missing)?;
    if output.status.success() {
        return Ok(());
    }
    Err(failure_of(
        output.status.code(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// 文字起こしする。区切りが届くたびに進み具合（0〜1）を知らせる。`should_stop` が真に
/// なったら子プロセスを止めて `Failure::Stopped`
pub fn run(
    helper: &Path,
    input: &Path,
    mut on_progress: impl FnMut(f64),
    should_stop: impl Fn() -> bool,
) -> Result<Transcript, Failure> {
    let mut child = Command::new(helper)
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| Failure::Missing)?;
    let stdout = child.stdout.take().ok_or(Failure::Missing)?;
    let mut stderr = child.stderr.take().ok_or(Failure::Missing)?;
    // 読むのは別の糸で。読み取りで止まっている間も「止める」を見られるように
    let (lines, received) = mpsc::channel::<String>();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let mut transcript = Transcript::default();
    loop {
        if should_stop() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Failure::Stopped);
        }
        match received.recv_timeout(POLL) {
            Ok(line) => match parse_line(&line) {
                Some(Event::Duration(seconds)) => transcript.duration = seconds,
                Some(Event::Segment(segment)) => {
                    if transcript.duration > 0.0 {
                        on_progress((segment.at / transcript.duration).clamp(0.0, 1.0));
                    }
                    transcript.segments.push(segment);
                }
                None => {}
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = reader.join();
    let status = child
        .wait()
        .map_err(|error| Failure::Failed(error.to_string()))?;
    let stderr = errors.join().unwrap_or_default();
    if status.success() {
        Ok(transcript)
    } else {
        Err(failure_of(status.code(), stderr))
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// 偽の実行ファイル（シェルのスクリプト）を置く。本物の文字起こしをせずに約束だけを試す
    fn fake(dir: &tempfile::TempDir, script: &str) -> PathBuf {
        let path = dir.path().join("oboegaki-transcribe");
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn test_行を読む() {
        assert_eq!(
            parse_line("duration\t1257.75"),
            Some(Event::Duration(1257.75))
        );
        assert_eq!(
            parse_line("segment\t20.82\t実はこれ\tタブ入り"),
            Some(Event::Segment(Segment {
                at: 20.82,
                text: "実はこれ\tタブ入り".into()
            }))
        );
        assert_eq!(parse_line("segment\tx\t文"), None);
        assert_eq!(parse_line("segment\t1.0\t   "), None, "空の文は捨てる");
        assert_eq!(parse_line("何か別の行"), None);
    }

    #[test]
    fn test_時刻は分と秒_1_時間を超えたら時も() {
        assert_eq!(stamp(0.0), "00:00");
        assert_eq!(stamp(83.9), "01:23");
        assert_eq!(stamp(3725.0), "1:02:05");
    }

    #[test]
    fn test_文字起こしを受け取り_進み具合を知らせる() {
        let dir = tempfile::tempdir().unwrap();
        let helper = fake(
            &dir,
            "printf 'duration\\t60\\nsegment\\t0.0\\tこんにちは\\nsegment\\t30.5\\t二つ目\\n'",
        );
        let mut seen = Vec::new();
        let transcript = run(
            &helper,
            Path::new("/v/会議.m4a"),
            |done| seen.push(done),
            || false,
        )
        .unwrap();
        assert_eq!(transcript.duration, 60.0);
        assert_eq!(transcript.lines(), "[00:00] こんにちは\n[00:30] 二つ目\n");
        assert_eq!(seen, vec![0.0, 30.5 / 60.0]);
    }

    #[test]
    fn test_入力のパスはそのまま渡す() {
        let dir = tempfile::tempdir().unwrap();
        let helper = fake(&dir, "printf 'duration\\t1\\nsegment\\t0\\t%s\\n' \"$1\"");
        let transcript = run(
            &helper,
            Path::new("/v/空白 と 日本語.m4a"),
            |_| {},
            || false,
        )
        .unwrap();
        assert_eq!(transcript.segments[0].text, "/v/空白 と 日本語.m4a");
    }

    #[test]
    fn test_終わり方ごとに読める理由にする() {
        let dir = tempfile::tempdir().unwrap();
        let cases = [
            (3, Failure::OldMacos),
            (4, Failure::NoLanguage),
            (5, Failure::Unreadable("読めない".into())),
            (6, Failure::Failed("失敗".into())),
        ];
        for (code, expected) in cases {
            let message = match &expected {
                Failure::Unreadable(m) | Failure::Failed(m) => m.clone(),
                _ => String::new(),
            };
            let helper = fake(&dir, &format!("echo '{message}' >&2; exit {code}"));
            let got = run(&helper, Path::new("/v/a.m4a"), |_| {}, || false).unwrap_err();
            assert_eq!(got, expected, "終わり方 {code}");
        }
    }

    #[test]
    fn test_実行ファイルが無ければそう言う() {
        let got = run(
            Path::new("/無い/oboegaki-transcribe"),
            Path::new("/v/a.m4a"),
            |_| {},
            || false,
        )
        .unwrap_err();
        assert_eq!(got, Failure::Missing);
    }

    #[test]
    fn test_止めたらすぐ戻り_子プロセスも止める() {
        // 何も出さずに黙る（長い録音を読んでいる間）
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("まだ動いている");
        let helper = fake(
            &dir,
            &format!(
                "printf 'duration\\t600\\n'; sleep 2; touch '{}'",
                marker.display()
            ),
        );
        let started = std::time::Instant::now();
        let stop_at = started + std::time::Duration::from_millis(300);
        let got = run(
            &helper,
            Path::new("/v/a.m4a"),
            |_| {},
            || std::time::Instant::now() >= stop_at,
        )
        .unwrap_err();
        assert_eq!(got, Failure::Stopped);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
        std::thread::sleep(std::time::Duration::from_millis(2500));
        assert!(!marker.exists(), "止めたあとも子プロセスが動き続けた");
    }

    #[test]
    fn test_使えるかを確かめる() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(probe(&fake(&dir, "exit 0")), Ok(()));
        assert_eq!(probe(&fake(&dir, "exit 3")), Err(Failure::OldMacos));
        assert_eq!(probe(&fake(&dir, "exit 4")), Err(Failure::NoLanguage));
        assert_eq!(probe(Path::new("/無い/x")), Err(Failure::Missing));
    }

    #[test]
    fn test_実行ファイルは自分の隣を探す() {
        let exe = Path::new("/Applications/OboeGaki.app/Contents/MacOS/oboegaki");
        assert_eq!(
            helper_beside(exe),
            PathBuf::from("/Applications/OboeGaki.app/Contents/MacOS/oboegaki-transcribe")
        );
    }

    /// 本物の部品で本物の録音を起こす（手で回す。録音は環境変数で渡す）:
    /// `make transcriber && OBOEGAKI_TRANSCRIBE_SAMPLE=<録音> cargo test transcribe::tests::test_本物 -- --ignored --nocapture`
    #[test]
    #[ignore = "本物の部品（make transcriber）と録音が要る"]
    fn test_本物の部品で起こせる() {
        let sample = std::env::var("OBOEGAKI_TRANSCRIBE_SAMPLE")
            .expect("OBOEGAKI_TRANSCRIBE_SAMPLE に録音のパス");
        let helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/debug")
            .join(HELPER);
        assert_eq!(probe(&helper), Ok(()));
        let started = std::time::Instant::now();
        let mut last = 0.0;
        let transcript = run(&helper, Path::new(&sample), |done| last = done, || false).unwrap();
        println!(
            "{:.0} 秒の録音を {:?} で / {} 区切り / {} 字 / 最後の進み {:.2}",
            transcript.duration,
            started.elapsed(),
            transcript.segments.len(),
            transcript.lines().chars().count(),
            last
        );
        assert!(!transcript.segments.is_empty());
    }
}
