// ゴミ箱（ADR-0025）: 入れる・一覧・戻す・完全に消す・空にする。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{guarded, CmdError, CmdResult, WatchState};
use crate::index_db::IndexDb;
use crate::vault::Vault;
use std::path::Path;

#[tauri::command]
pub fn note_trash(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let vault = Vault::new(&root);
    // 削除ガードと履歴の引っ越しは vault が持つ（MCP からも同じ道を通る）
    let moved = vault.trash_note(&path)?;
    state.suppressor.mark(&moved);
    // ゴミ箱の中は索引に入れない（検索・一覧の対象外）
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.remove(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn trash_list(root: String) -> CmdResult<Vec<TrashItem>> {
    Ok(Vault::new(&root)
        .trash_entries()
        .into_iter()
        .map(|entry| TrashItem {
            path: entry.path.to_string_lossy().into_owned(),
            trashed_ms: entry.trashed_ms,
        })
        .collect())
}

/// ゴミ箱の 1 件（画面へ渡す形）。
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct TrashItem {
    pub path: String,
    /// 捨てた時刻。ミリ秒（JS の Date と突き合わせやすい単位）
    pub trashed_ms: i64,
}

/// ゴミ箱の 1 件を完全に消す（G-3）。ゴミ箱の外は消さない。
#[tauri::command]
pub fn trash_delete(root: String, path: String) -> CmdResult<()> {
    Vault::new(&root)
        .delete_permanently(Path::new(&path))
        .map_err(CmdError::from)
}

/// ゴミ箱を空にする（G-3）。確認を取るのはフロント側の仕事。
#[tauri::command]
pub fn trash_empty(root: String) -> CmdResult<()> {
    Vault::new(&root)
        .empty_trash()
        .map(|_| ())
        .map_err(CmdError::from)
}

#[tauri::command]
pub fn note_restore(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let vault = Vault::new(&root);
    // 版は vault.restore が連れて戻る（trash と対称。鍵はファイルに付いて回る =
    // ADR-0042。戻した先の名前が変わっても同じ）
    let restored = vault.restore(&path)?;
    state.suppressor.mark(&restored);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &restored))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(restored.to_string_lossy().into_owned())
}
