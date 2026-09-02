// Tauri commands。フロントとの境界の薄い層で、ロジックは持たない（T3）。
// パスを受け取る command は必ず vault::contains で封じ込めを確認する。

use std::fs;
use std::path::Path;

use crate::autosave;
use crate::vault::{contains, Vault};

fn guarded(root: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let candidate = Path::new(path).to_path_buf();
    if contains(Path::new(root), &candidate) {
        Ok(candidate)
    } else {
        Err(format!("vault の外を指しています: {path}"))
    }
}

/// vault を開く: 改名引き継ぎ + レイアウト作成 + 走査。
#[tauri::command]
pub fn vault_open(root: String) -> Result<Vec<String>, String> {
    let vault = Vault::new(&root);
    vault.ensure_layout().map_err(|e| e.to_string())?;
    Ok(vault
        .scan()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn note_read(root: String, path: String) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_write(root: String, path: String, text: String) -> Result<(), String> {
    let path = guarded(&root, &path)?;
    autosave::save_atomic(&path, &text).map_err(|e| e.to_string())
}
