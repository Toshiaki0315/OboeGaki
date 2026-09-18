// ローカル LLM（ADR-0044）と OCR。重いものは async でメインスレッドから逃がす。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{decode, CmdError, CmdResult, FlagGuard, WatchState};

// ------------------------------------------------------------ ローカルLLM

/// Ollama が動いているか（TASKS 4-8 / ADR-0025）。
///
/// **押してから断らない**ための確認。動いていなければ機能ごと畳む。
#[tauri::command]
pub async fn llm_available(port: u16) -> bool {
    crate::llm::available(port)
}

/// 入っているモデルの名前（設定の候補に出す）。
#[tauri::command]
pub async fn llm_models(port: u16) -> Vec<String> {
    crate::llm::models(port)
}

/// そのモデルが今メモリに載っているか（載っていなければ「読み込んで
/// います…」と言えるようにする）。
#[tauri::command]
pub async fn llm_loaded(port: u16, model: String) -> bool {
    crate::llm::is_loaded(port, &model)
}

/// 走っている生成を止める（L-1）。**受け取ったぶんはそのまま残す** —
/// 途中まででも読める答えが出ていることがある。
///
/// 止まるのは次の一片が届いたとき。Ollama は細かく流してくるので、
/// 押してすぐ止まる。
#[tauri::command]
pub fn llm_stop(state: tauri::State<'_, WatchState>) {
    use std::sync::atomic::Ordering;
    state.stop_generating.store(true, Ordering::SeqCst);
}

/// モデルをメモリから降ろす。**答えの途中では降ろさない**（走っている
/// 生成を壊す）ので、走っている間は断る。
#[tauri::command]
pub async fn llm_unload(
    state: tauri::State<'_, WatchState>,
    port: u16,
    model: String,
) -> CmdResult<bool> {
    use std::sync::atomic::Ordering;
    if state.generating.load(Ordering::SeqCst) {
        return Ok(false);
    }
    crate::llm::unload(port, &model)?;
    Ok(true)
}

/// ノートを読ませる（TASKS 4-8）。始めたら true、走っている最中なら false。
///
/// **打鍵の経路に入れない**（spec §6.6）。生成は別スレッドで回し、流れて
/// きたぶんは `llm-chunk` で送る（最初の 1 文字まで数秒あり、黙って
/// 待たせない）。終わりは `llm-done`、失敗は `llm-failed`。
/// 生成の注文（画面の `lib/ipc.llmGenerate` が組む）。設定（port / model / context /
/// timeout / keep_alive）と注文（task / title / body / question / sources）を 1 つに
/// （引数 10 個で clippy の警告を黙らせていた。19-4 の残り）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub port: u16,
    pub model: String,
    pub task: String,
    pub title: String,
    pub body: String,
    /// vault 全体への質問（L-2）。`task` が `question` のときだけ使う。
    /// 材料（題名, 本文）を**探すのは画面側**（索引を引く）
    pub question: Option<String>,
    pub sources: Option<Vec<(String, String)>>,
    pub context: u32,
    pub timeout_minutes: u64,
    pub keep_alive: String,
}

#[tauri::command]
pub fn llm_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    request: GenerateRequest,
) -> CmdResult<bool> {
    use std::sync::atomic::Ordering;
    let GenerateRequest {
        port,
        model,
        task,
        title,
        body,
        question,
        sources,
        context,
        timeout_minutes,
        keep_alive,
    } = request;
    if state.generating.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    state.stop_generating.store(false, Ordering::SeqCst);
    let generating = state.generating.clone();
    let stop = state.stop_generating.clone();
    std::thread::spawn(move || {
        use tauri::Emitter;
        let _flag = FlagGuard(generating); // パニックしても必ず降ろす
        let prompt = if task == "question" {
            // 材料が無ければ読ませない（作り話が出るし、GPU を回す意味もない）
            match crate::llm::question_prompt(
                &question.unwrap_or_default(),
                &sources.unwrap_or_default(),
            ) {
                Some(prompt) => prompt,
                None => {
                    let _ = app.emit("llm-failed", "材料になるノートがありません");
                    return;
                }
            }
        } else {
            crate::llm::prompt_for(&task, &title, &body)
        };
        // 分は 1〜120 に丸める（極端な値の乗算パニックと「実質無限」を防ぐ）
        let minutes = timeout_minutes.clamp(1, 120);
        let outcome = crate::llm::generate(
            crate::llm::Generation {
                port,
                model: &model,
                prompt: &prompt,
                context,
                timeout: std::time::Duration::from_secs(minutes * 60),
                keep_alive: &keep_alive,
            },
            |piece| {
                let _ = app.emit("llm-chunk", piece);
            },
            || stop.load(Ordering::SeqCst),
        );
        match outcome {
            Ok(answer) => {
                let _ = app.emit("llm-done", answer);
            }
            Err(error) => {
                let _ = app.emit("llm-failed", error.to_string());
            }
        }
    });
    Ok(true)
}

/// 絵から文字を読む（TASKS 4-7 / ADR-0041）。読めなければ空。
///
/// 受け取るのは base64 の画像。**元のファイルは触らない** — 読み取った
/// 文字を返すだけで、ノートにするのは呼び出し側の仕事。
/// 読み取りの読み手（ADR-0027 決定 1「読み手を 2 つ持ち、設定で選ぶ」）。
/// 画面の環境設定から来る。`engine` が "llm" のときだけ Ollama に頼み、
/// それ以外（無指定を含む）は macOS の Vision。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrReader {
    pub engine: String,
    pub port: u16,
    pub model: String,
    pub context: u32,
    pub timeout_minutes: u64,
    pub keep_alive: String,
}

/// 読み取りの待ち時間。生成（llm_generate）と同じ 1〜120 分に丸める —
/// 設定の欄から 0 や巨大な値が来ても、即切れ・無限待ちにしない
fn ocr_timeout(minutes: u64) -> std::time::Duration {
    std::time::Duration::from_secs(minutes.clamp(1, 120) * 60)
}

/// 読み手に応じて画像を読む。**どちらも無ければ畳む**（ADR-0027 決定 4）—
/// Ollama が動いていなければ Err で知らせ、Vision は読めなければ空。
fn recognize_with(reader: Option<&OcrReader>, image: &[u8]) -> CmdResult<String> {
    match reader {
        Some(reader) if reader.engine == "llm" => crate::llm::read_image(
            crate::llm::Generation {
                port: reader.port,
                model: &reader.model,
                prompt: crate::llm::OCR_PROMPT,
                context: reader.context,
                timeout: ocr_timeout(reader.timeout_minutes),
                keep_alive: &reader.keep_alive,
            },
            image,
        )
        .map_err(CmdError::from),
        _ => Ok(crate::ocr::recognize(image)),
    }
}

/// PDF のページを読み手に応じて読む。LLM には絵をファイルの形（PNG）で
/// 渡し、Vision には描いた絵をそのまま渡す。描けないページは空
fn read_pdf_page_with(bytes: &[u8], page: usize, reader: Option<&OcrReader>) -> CmdResult<String> {
    match reader {
        Some(chosen) if chosen.engine == "llm" => match crate::pdf::render_png(bytes, page) {
            Some(png) => recognize_with(Some(chosen), &png),
            None => Ok(String::new()),
        },
        _ => Ok(crate::pdf::read_page(bytes, page)),
    }
}

/// 読み取りは**別スレッドで待つ**。LLM は設定どおり分単位で待つことがあり、
/// async の中で同期に待つと保存・監視・検索の IPC まで詰まる
/// （ADR-0027 の「読み込みで固まる」と同じ種類。レビュー 2026-09-07）
#[tauri::command]
pub async fn ocr_image(data: String, reader: Option<OcrReader>) -> CmdResult<String> {
    let bytes = decode(&data)?;
    tauri::async_runtime::spawn_blocking(move || recognize_with(reader.as_ref(), &bytes)).await?
}

/// PDF のページを絵にして読む（実機報告 2026-09-05）。
///
/// **画面（pdf.js）で描かない。** ワーカーと canvas が要る経路は、
/// そこが動かないと読み取りに辿り着く前に終わる。同じ機械の中で完結させる。
#[tauri::command]
pub async fn ocr_pdf_page(
    data: String,
    page: usize,
    reader: Option<OcrReader>,
) -> CmdResult<String> {
    let bytes = decode(&data)?;
    tauri::async_runtime::spawn_blocking(move || read_pdf_page_with(&bytes, page, reader.as_ref()))
        .await?
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_読み手_ローカルLLMが動いていなければ断る() {
        let reader = OcrReader {
            engine: "llm".into(),
            port: 1, // 誰も居ないポート
            model: "m".into(),
            context: 4096,
            timeout_minutes: 1,
            keep_alive: "5m".into(),
        };
        let failed = recognize_with(Some(&reader), b"not an image").unwrap_err();
        assert!(failed.contains("not-running"), "{failed}");
    }

    #[test]
    fn test_読み取りの待ち時間は生成と同じ幅に丸める() {
        // 設定の欄から 0 や巨大な値が来ても、即切れ・無限待ちにしない
        assert_eq!(ocr_timeout(0), std::time::Duration::from_secs(60));
        assert_eq!(ocr_timeout(6), std::time::Duration::from_secs(6 * 60));
        assert_eq!(ocr_timeout(9999), std::time::Duration::from_secs(120 * 60));
    }

    #[test]
    fn test_PDFのページ_ローカルLLMならPNGにしてから読みに行く() {
        // 絵だけの PDF の 1 ページ目を LLM に回す。誰も居ないポートなので
        // 「動いていない」で断られる = PNG 化を経て LLM に届いたことの証
        let pdf = include_bytes!("../../../fixtures/image-only.pdf");
        let reader = OcrReader {
            engine: "llm".into(),
            port: 1,
            model: "m".into(),
            context: 4096,
            timeout_minutes: 1,
            keep_alive: "5m".into(),
        };
        let failed = read_pdf_page_with(pdf, 1, Some(&reader)).unwrap_err();
        assert!(failed.contains("not-running"), "{failed}");
        // 無いページは描けないので、LLM に行かず空
        assert_eq!(read_pdf_page_with(pdf, 99, Some(&reader)).unwrap(), "");
        // 読み手が無ければ Vision（絵だけのページは何か読めるか空）
        assert!(read_pdf_page_with(pdf, 1, None).is_ok());
    }

    #[test]
    fn test_読み手_指定が無ければmacOSで読む() {
        // Vision は画像でなければ空を返す（読めないことは壊れることではない）
        assert_eq!(recognize_with(None, b"not an image").unwrap(), "");
        let mac = OcrReader {
            engine: "mac".into(),
            port: 1,
            model: String::new(),
            context: 0,
            timeout_minutes: 1,
            keep_alive: String::new(),
        };
        assert_eq!(recognize_with(Some(&mac), b"not an image").unwrap(), "");
    }
}
