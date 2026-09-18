// 画像・添付・書き出し・取り込み・印刷（フロントとの base64 のやり取り）。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{decode, guarded, CmdError, CmdResult, WatchState};
use crate::vault::Vault;
use std::fs;
use std::path::Path;

/// 書き出しの保存（HTML など）。保存先はネイティブの保存ダイアログで
/// ユーザーが選んだパスなので、vault の封じ込め検査は掛けない
/// （掛けると書き出し先を vault の中に縛ってしまう）。
#[tauri::command]
pub async fn export_write(path: String, text: String) -> CmdResult<()> {
    crate::autosave::save_bytes_atomic(Path::new(&path), text.as_bytes()).map_err(CmdError::from)
}

/// 本文の画像参照を data URL で返す（ADR-0004）。解決の起点は vault ルート。
#[tauri::command]
pub fn image_read(root: String, path: String) -> CmdResult<String> {
    crate::assets::read_data_url(Path::new(&root), Path::new(&path)).map_err(CmdError::from)
}

/// 画像などの添付を `attachments/` へ保存し、本文へ挿す Markdown を返す
/// （TASKS 1-2）。中身は base64 で受ける（Tauri の JSON 経路で運ぶため）。
#[tauri::command]
pub fn attachment_save(root: String, data: String, suffix: String) -> CmdResult<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&data)?;
    let vault = Vault::new(&root);
    let saved = vault.add_attachment(&bytes, &suffix)?;
    Ok(vault.attachment_link(&saved))
}

/// どのノートからも指されていない添付（E-5）。絶対パスを名前順で返す。
#[tauri::command]
pub async fn attachments_unused(root: String) -> CmdResult<Vec<String>> {
    Ok(Vault::new(&root)
        .unused_attachments()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// 添付をゴミ箱へ移す（E-5）。移した数を返す。
#[tauri::command]
pub async fn attachments_trash(
    state: tauri::State<'_, WatchState>,
    root: String,
    paths: Vec<String>,
) -> CmdResult<usize> {
    let vault = Vault::new(&root);
    let mut targets = Vec::new();
    for path in paths {
        let path = guarded(&root, &path)?;
        state.suppressor.mark(&path);
        targets.push(path);
    }
    Ok(vault.trash_attachments(&targets).len())
}

/// 書き出したファイルをそのまま置く（base64 で受け取る）。
///
/// PowerPoint（TASKS 4-5）のように**中身がバイト列**のものに使う。
/// 置き場はユーザーが選んだ場所なので vault の外でよい。
#[tauri::command]
pub async fn export_write_binary(path: String, data: String) -> CmdResult<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(&data)?;
    // 書き出しもアトミックに（export_write と同じ）。途中で落ちて
    // 壊れた .pptx が残らない（レビュー 2026-09-04）
    crate::autosave::save_bytes_atomic(Path::new(&path), &bytes).map_err(CmdError::from)
}

/// 取り込むファイルを base64 で読む（TASKS 4-5 の PowerPoint など）。
///
/// **vault の外を読む。** 取り込みは外から持ってくる操作で、置き場を
/// 選ぶのはユーザー。書き込みはしないので、封じ込めの対象にしない。
#[tauri::command]
pub async fn import_read(path: String) -> CmdResult<String> {
    // 丸ごとメモリへ載せて base64（1.33 倍）で運ぶ経路なので、上限を切る。
    // 500MB の PDF で実質 2GB 近く食う（レビュー 2026-09-04）
    const MAX_IMPORT_BYTES: u64 = 256 * 1024 * 1024;
    let size = fs::metadata(&path)?.len();
    if size > MAX_IMPORT_BYTES {
        return Err(format!(
            "ファイルが大きすぎます（{}MB。上限 256MB）",
            size / (1024 * 1024)
        )
        .into());
    }
    use base64::Engine;
    let bytes = fs::read(&path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// PDF のページ数（TASKS 4-6）。読めなければ 0。
#[tauri::command]
pub async fn pdf_page_count(data: String) -> CmdResult<usize> {
    Ok(crate::pdf::page_count(&decode(&data)?))
}

/// 印刷（TASKS 4-3）。macOS の印刷パネルを出す（「PDF として保存」もここ）。
///
/// 印刷されるのは**この WebView に今出ているもの**なので、何を出すかは
/// フロント側の `@media print` が決める（ADR-0038）。
#[tauri::command]
pub fn print_page(window: tauri::WebviewWindow) -> CmdResult<()> {
    window.print().map_err(CmdError::from)
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_import_read_大きすぎるファイルは断り_小さいものは_base64() {
        let dir = tempfile::TempDir::new().unwrap();
        let small = dir.path().join("s.bin");
        std::fs::write(&small, b"ab").unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        assert_eq!(
            runtime
                .block_on(import_read(small.to_str().unwrap().into()))
                .unwrap(),
            "YWI="
        );
        // スパースファイルなのでディスクは食わない
        let huge = dir.path().join("h.bin");
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(257 * 1024 * 1024)
            .unwrap();
        let denied = runtime
            .block_on(import_read(huge.to_str().unwrap().into()))
            .unwrap_err();
        assert!(denied.contains("大きすぎます"), "{denied}");
    }
}
