// フォルダの一覧・作成・改名・移動・削除（中のノートの履歴も付いて回る）。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{CmdError, CmdResult, WatchState};
use crate::history;
use crate::index_db::IndexDb;
use crate::vault::Vault;
use std::path::PathBuf;

/// そのフォルダ（相対）の下にあるノート
pub fn notes_under(vault: &Vault, folder: &str) -> Vec<PathBuf> {
    vault
        .scan()
        .into_iter()
        .filter(|path| {
            path.strip_prefix(vault.root())
                .map(|relative| relative.starts_with(folder))
                .unwrap_or(false)
        })
        .collect()
}

/// フォルダの名前が変わった・動いたあと、中のノートの履歴の置き場を付け替える。
/// 旧鍵は、新しい鍵の頭（`path:after`）を元の名前（`path:before`）へ戻したもの。
/// Tauri を知らないので headless で試せる（T3）
pub fn rekey_moved_folder(vault: &Vault, before: &str, after: &str, moved: &[PathBuf]) {
    let store = history::store_root(&vault.managed_dir());
    let head_after = format!("path:{}", crate::vault::nfc_string(after));
    let head_before = format!("path:{}", crate::vault::nfc_string(before));
    for path in moved {
        let after_key = vault.history_key(path);
        let old_key = after_key.replacen(&head_after, &head_before, 1);
        if let Err(error) = history::rekey(&store, &old_key, &after_key) {
            eprintln!("履歴の置き場を移せなかった: {error}");
        }
    }
}

/// サイドバーのフォルダツリーの素材（ADR-0024）。
/// **存在はディスク、件数は索引**（索引にあってディスクに無いものは出さない）。
/// 先頭は必ず直下（空文字）。
#[tauri::command]
pub async fn folder_list(root: String) -> CmdResult<Vec<(String, i64)>> {
    let vault = Vault::new(&root);
    let db = IndexDb::open(&vault.managed_dir())?;
    Ok(crate::note_service::folders_with_counts(
        &vault,
        &db,
        |_| true,
    )?)
}

/// そのフォルダ**直下**のノート（ADR-0024 追記 4）。
#[tauri::command]
pub fn notes_in_folder(root: String, folder: String) -> CmdResult<Vec<crate::index_db::NoteMeta>> {
    let vault = Vault::new(&root);
    let db = IndexDb::open(&vault.managed_dir())?;
    Ok(crate::note_service::list_notes(&db, Some(&folder), None)?)
}

#[tauri::command]
pub fn folder_create(root: String, folder: String) -> CmdResult<String> {
    Vault::new(&root)
        .create_folder(&folder)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(CmdError::from)
}

/// フォルダの名前を変える。新しい相対パスを返す。
///
/// 中のノートはパスが変わるので、索引を取り直し、履歴の置き場も
/// 付け替える（鍵がパスなので、そのままだと履歴が見えなくなる）。
#[tauri::command]
pub fn folder_rename(
    state: tauri::State<'_, WatchState>,
    root: String,
    folder: String,
    name: String,
) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let before = folder.trim_matches('/').to_string();
    let renamed = vault.rename_folder(&folder, &name)?;
    after_folder_moved(&state, &vault, &before, &renamed);
    Ok(renamed)
}

/// フォルダを別のフォルダの中へ移す（要望 2026-09-10）。`into` は空文字で直下。
#[tauri::command]
pub fn folder_move(
    state: tauri::State<'_, WatchState>,
    root: String,
    folder: String,
    into: String,
) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let before = folder.trim_matches('/').to_string();
    let moved = vault.move_folder(&folder, &into)?;
    if moved != before {
        after_folder_moved(&state, &vault, &before, &moved);
    }
    Ok(moved)
}

/// フォルダの名前が変わった・動いたあとの後追い（改名と移動で共通）。
/// 中のノートの監視イベントを抑え、履歴の置き場を付け替え、索引を同期する
fn after_folder_moved(
    state: &tauri::State<'_, WatchState>,
    vault: &Vault,
    before: &str,
    after_path: &str,
) {
    let moved = notes_under(vault, after_path);
    for path in &moved {
        state.suppressor.mark(path);
    }
    rekey_moved_folder(vault, before, after_path, &moved);
    let sync_outcome = {
        let _serialized = state
            .sync_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(vault))
    };
    if let Err(error) = sync_outcome {
        eprintln!("索引の更新に失敗した: {error}");
    }
}

#[tauri::command]
pub fn folder_delete(root: String, folder: String) -> CmdResult<()> {
    Vault::new(&root)
        .delete_folder(&folder)
        .map_err(CmdError::from)
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::commands::history::history_root;
    use crate::test_support::temp_vault;

    #[test]
    fn test_rekey_moved_folder_フォルダの改名と移動で版が付いて回る() {
        let (root, vault) = temp_vault();
        std::fs::create_dir_all(root.path().join("仕事")).unwrap();
        std::fs::write(root.path().join("仕事/a.md"), "# a\n").unwrap();
        let store = history_root(root.path().to_str().unwrap());
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        history::keep(&store, "path:仕事/a.md", "古い", at, true, 0).unwrap();

        let renamed = vault.rename_folder("仕事", "仕事2").unwrap();
        let moved = notes_under(&vault, &renamed);
        assert_eq!(moved.len(), 1);
        rekey_moved_folder(&vault, "仕事", &renamed, &moved);
        assert_eq!(history::versions(&store, "path:仕事2/a.md").len(), 1);
        assert!(history::versions(&store, "path:仕事/a.md").is_empty());

        std::fs::create_dir_all(root.path().join("古い")).unwrap();
        let into = vault.move_folder("仕事2", "古い").unwrap();
        let moved = notes_under(&vault, &into);
        rekey_moved_folder(&vault, "仕事2", &into, &moved);
        assert_eq!(history::versions(&store, "path:古い/仕事2/a.md").len(), 1);
        assert!(history::versions(&store, "path:仕事2/a.md").is_empty());
    }
}
