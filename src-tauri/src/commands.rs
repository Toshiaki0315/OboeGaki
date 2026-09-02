// Tauri commands。フロントとの境界の薄い層で、ロジックは持たない（T3）。
// パスを受け取る command は必ず vault::contains で封じ込めを確認する。
// ファイルを動かす command は Suppressor に記録し、自分の書き込みが
// 「外部変更」としてフロントへ跳ね返らないようにする（spec §7.5）。

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::autosave;
use crate::index_db::{IndexDb, SearchHit};
use crate::vault::{contains, Vault};
use crate::watcher::{self, Suppressor};

/// vault ごとに 1 本の watcher と、自書き込みの無視リスト。
/// 新しい vault を開いたら watcher を置き換える（drop で旧監視は止まる）。
pub struct WatchState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    suppressor: Arc<Suppressor>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            suppressor: Arc::new(Suppressor::default()),
        }
    }
}

fn guarded(root: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let candidate = Path::new(path).to_path_buf();
    if contains(Path::new(root), &candidate) {
        Ok(candidate)
    } else {
        Err(format!("vault の外を指しています: {path}"))
    }
}

/// vault を開く: 改名引き継ぎ + レイアウト作成 + 監視開始 + 走査。
#[tauri::command]
pub fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    root: String,
) -> Result<Vec<String>, String> {
    let vault = Vault::new(&root);
    vault.ensure_layout().map_err(|e| e.to_string())?;
    // 監視と索引は付随機能なので、失敗しても vault は開く（ログだけ残す）
    match watcher::start(app, vault.root().to_path_buf(), state.suppressor.clone()) {
        Ok(active) => *state.watcher.lock().expect("watcher lock") = Some(active),
        Err(error) => eprintln!("外部変更の監視を開始できなかった: {error}"),
    }
    if let Err(error) = IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(&vault)) {
        eprintln!("索引の同期に失敗した（検索は古いままになる）: {error}");
    }
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
pub fn note_write(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    autosave::save_atomic(&path, &text).map_err(|e| e.to_string())?;
    // 索引の後追い。失敗しても保存は成立している（次の sync が取り直す）
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(())
}

#[tauri::command]
pub fn note_search(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.search(&query))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_create(
    state: tauri::State<WatchState>,
    root: String,
    title: String,
) -> Result<String, String> {
    let vault = Vault::new(&root);
    let path = vault.create(&title).map_err(|e| e.to_string())?;
    state.suppressor.mark(&path);
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn note_rename(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    title: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let renamed = Vault::new(&root)
        .rename(&path, &title)
        .map_err(|e| e.to_string())?;
    state.suppressor.mark(&renamed);
    Ok(renamed.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn note_trash(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let moved = Vault::new(&root).trash(&path).map_err(|e| e.to_string())?;
    state.suppressor.mark(&moved);
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn trash_list(root: String) -> Result<Vec<String>, String> {
    Ok(Vault::new(&root)
        .trash_list()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn note_restore(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let restored = Vault::new(&root)
        .restore(&path)
        .map_err(|e| e.to_string())?;
    state.suppressor.mark(&restored);
    Ok(restored.to_string_lossy().into_owned())
}
