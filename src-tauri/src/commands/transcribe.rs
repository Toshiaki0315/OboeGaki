// 音声・動画の文字起こし（TASKS 28-1 / ADR-0070）。Tauri commands の薄い層（T3）。
// 文字起こしは同梱の Swift の実行ファイル（transcribe.rs が呼ぶ）。分け方は commands/mod.rs を見る

use super::{CmdError, CmdResult, FlagGuard, WatchState};
use std::sync::atomic::Ordering;
use tauri::Emitter;

/// 文字起こしの結果（画面はこれから議事録とノートを組む）
#[derive(serde::Serialize)]
pub struct TranscribeResult {
    /// 録音の長さ（秒）
    pub duration: f64,
    /// `[mm:ss] 文` を 1 行ずつ
    pub lines: String,
}

/// 文字起こしが使えるか（macOS 26・日本語の言語データ）。使えなければ理由
#[tauri::command]
pub async fn transcribe_probe() -> CmdResult<()> {
    crate::transcribe::probe(&crate::transcribe::helper_path())
        .map_err(|error| CmdError(error.to_string()))
}

/// 文字起こしする。進み具合（0〜1）は `transcribe-progress` で知らせる。
/// 音声は外へ出さない（この Mac の中の SpeechAnalyzer）
#[tauri::command]
pub async fn transcribe_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    path: String,
) -> CmdResult<TranscribeResult> {
    if state.transcribing.swap(true, Ordering::SeqCst) {
        return Err(CmdError("文字起こしが走っています".into()));
    }
    state.stop_transcribing.store(false, Ordering::SeqCst);
    let flag = FlagGuard(state.transcribing.clone()); // 失敗しても必ず降ろす
    let stop = state.stop_transcribing.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _flag = flag;
        crate::transcribe::run(
            &crate::transcribe::helper_path(),
            std::path::Path::new(&path),
            |done| {
                let _ = app.emit("transcribe-progress", done);
            },
            || stop.load(Ordering::SeqCst),
        )
    })
    .await
    .map_err(|error| CmdError(error.to_string()))?;
    let transcript = outcome.map_err(|error| CmdError(error.to_string()))?;
    Ok(TranscribeResult {
        duration: transcript.duration,
        lines: transcript.lines(),
    })
}

/// 文字起こしを止める（子プロセスも止まる）
#[tauri::command]
pub fn transcribe_stop(state: tauri::State<'_, WatchState>) {
    state.stop_transcribing.store(true, Ordering::SeqCst);
}

/// 議事録を頼む中身（設定から）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinutesRequest {
    /// `[mm:ss] 文` の行（transcribe_file の lines）
    pub lines: String,
    pub port: u16,
    /// 議事録のモデル（28-5。既定は gemma3:12b）
    pub model: String,
    pub timeout_minutes: u64,
    pub keep_alive: String,
}

/// 議事録の窓（トークン）。区切り 1 つ（8,000 字まで）と頼み方が収まる
const MINUTES_CONTEXT: u32 = 16_384;

/// 文字起こしから議事録を作る（ADR-0070 決定 3: 長ければ区切って 2 段）。どの段かは
/// `minutes-stage` で知らせる。アシスタントと同じ旗を使い、同時には走らせない。止められる
#[tauri::command]
pub async fn minutes_make(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    request: MinutesRequest,
) -> CmdResult<String> {
    if state.generating.swap(true, Ordering::SeqCst) {
        return Err(CmdError(
            "アシスタントが考えています。終わってからもう一度".into(),
        ));
    }
    state.stop_generating.store(false, Ordering::SeqCst);
    let flag = FlagGuard(state.generating.clone());
    let stop = state.stop_generating.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _flag = flag;
        let timeout = std::time::Duration::from_secs(request.timeout_minutes.clamp(1, 120) * 60);
        crate::minutes::make_with(
            &request.lines,
            |prompt| {
                let answer = crate::llm::generate(
                    crate::llm::Generation {
                        port: request.port,
                        model: &request.model,
                        prompt,
                        context: MINUTES_CONTEXT,
                        timeout,
                        keep_alive: &request.keep_alive,
                    },
                    |_| {},
                    || stop.load(Ordering::SeqCst),
                )
                .map_err(|error| error.to_string())?;
                // 止められたら途中の答えでまとめに進まない
                if stop.load(Ordering::SeqCst) {
                    return Err("議事録づくりを止めました".into());
                }
                Ok(answer)
            },
            |stage| {
                let _ = app.emit("minutes-stage", stage);
            },
        )
    })
    .await
    .map_err(|error| CmdError(error.to_string()))?
    .map_err(CmdError)
}
