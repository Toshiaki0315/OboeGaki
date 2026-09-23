// 版の履歴（ADR-0023）: 一覧・読み・戻す・競合の写し・使用量。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{guarded, CmdError, CmdResult, WatchState};
use crate::autosave;
use crate::history;
use crate::index_db::IndexDb;
use crate::vault::Vault;
use std::path::Path;

/// ノートの履歴の鍵。字面は vault 側の 1 本（`vault::history_key`）に任せる —
/// `guarded` の実体パス（canonicalize 済み）からでも相対の NFC になる
pub(super) fn history_key(root: &str, path: &Path) -> String {
    crate::vault::history_key(Path::new(root), path)
}

pub(super) fn history_root(root: &str) -> std::path::PathBuf {
    history::store_root(&Vault::new(root).managed_dir())
}

/// 版を書き戻す。戻す前に今の内容を 1 版残す（取り消せない操作を増やさない）。
/// 返り値は書き戻したあとの本文。Tauri を知らないので headless で試せる（T3）
pub fn restore_version(root: &str, note: &Path, version: &Path) -> CmdResult<String> {
    let version = version_in_history(root, note, version)?;
    let store = history_root(root);
    let key = history_key(root, note);
    let now = chrono::Local::now().naive_local();
    // **今の内容を版に残せたことが、書き戻す前提。** 残せないまま書き戻すと
    // 今の本文はどこにも無くなる — それこそ「取り消せない操作」になる
    // （レビュー 2026-09-23。以前は eprintln だけで書き戻していた）。
    // ノートが無いときだけは残すものが無いので、そのまま戻してよい
    match crate::vault::read_note(note) {
        Ok(current) => {
            if let Err(error) = history::keep(&store, &key, &current, now, true, 0) {
                return Err(CmdError(format!(
                    "今の内容を版に残せなかったので、戻すのを止めました: {error}"
                )));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CmdError(format!(
                "今の内容を読めなかったので、戻すのを止めました: {error}"
            )));
        }
    }
    // 版も Shift_JIS のことがある（読みは全部 read_note を通す。19-3）
    let text = crate::vault::read_note(&version)?;
    autosave::save_atomic(note, &text)?;
    Ok(text)
}

#[derive(serde::Serialize)]
pub struct HistoryEntry {
    pub stamp: String,
    pub path: String,
}

#[tauri::command]
pub fn history_list(root: String, path: String) -> CmdResult<Vec<HistoryEntry>> {
    let path = guarded(&root, &path)?;
    Ok(crate::note_service::versions(&Vault::new(&root), &path)
        .into_iter()
        .map(|version| HistoryEntry {
            stamp: version.stamp(),
            path: version.path.to_string_lossy().into_owned(),
        })
        .collect())
}

/// version が**このノートの履歴フォルダの中**にあることを確かめる。vault 内
/// なら何でも通すと、任意のノートの中身を「版」として書き戻したり覗いたり
/// できてしまう（レビュー 2026-09-04。フロントは history_list の戻りしか
/// 渡さないが、境界の層として閉じる）
fn version_in_history(root: &str, note: &Path, version: &Path) -> CmdResult<std::path::PathBuf> {
    let store = history_root(root);
    let key = history_key(root, note);
    let expected = store.join(history::folder_name(&key));
    let inside_history = version
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .zip(expected.canonicalize().ok())
        .map(|(parent, expected)| parent == expected)
        .unwrap_or(false);
    if !inside_history {
        return Err("このノートの版ではありません".into());
    }
    Ok(version.to_path_buf())
}

/// 版の本文を読む（ADR-0054 の差分表示。書き戻さない）。
#[tauri::command]
pub fn history_read(root: String, path: String, version: String) -> CmdResult<String> {
    let note = guarded(&root, &path)?;
    let version = version_in_history(&root, &note, &guarded(&root, &version)?)?;
    Ok(crate::vault::read_note(&version)?)
}

/// 版を書き戻す。戻す前に今の内容を 1 版残す（取り消せない操作を増やさない）。
/// 返り値は書き戻したあとの本文（フロントがエディタへ流し込む）。
#[tauri::command]
pub fn history_restore(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    version: String,
) -> CmdResult<String> {
    let note = guarded(&root, &path)?;
    let version = guarded(&root, &version)?;
    state.suppressor.mark(&note);
    let text = restore_version(&root, &note, &version)?;
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &note))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(text)
}

/// 競合の「両方残す」（spec §7.5）。自分の版を
/// `名前 (競合 YYYY-MM-DD).md` に保存し、その場所を返す。
/// 元のファイルは触らない（外部の版がそのまま残る）。
#[tauri::command]
pub fn conflict_copy(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    text: String,
) -> CmdResult<String> {
    let note = guarded(&root, &path)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let copy = crate::vault::conflict_copy_path(&note, &today);
    state.suppressor.mark(&copy);
    autosave::save_atomic(&copy, &text)?;
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &copy))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(copy.to_string_lossy().into_owned())
}

/// 履歴フォルダの使用量（バイト）。設定画面の表示用。
#[tauri::command]
pub async fn history_usage(root: String) -> CmdResult<u64> {
    Ok(history::usage(&history_root(&root)))
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::temp_vault;

    #[test]
    fn test_history_key_は_guarded_の実体パスからでも相対のNFC鍵になる() {
        // guarded は canonicalize した実体を返す（TempDir は /var → /private/var）。
        // 生 root の strip_prefix では外れて `path:/private/var/…` になっていた
        let root = tempfile::TempDir::new().unwrap();
        let root_str = root.path().to_str().unwrap();
        Vault::new(root.path()).ensure_layout().unwrap();
        let note = root.path().join("フ\u{309A}.md");
        std::fs::write(&note, "# a\n").unwrap();
        let real = guarded(root_str, note.to_str().unwrap()).unwrap();
        assert_eq!(history_key(root_str, &real), "path:プ.md");
    }

    /// 版の読み出し（ADR-0054）は書き戻しと同じ境界で受ける: **そのノートの
    /// 履歴フォルダの中**だけ。vault 内なら何でも読めると、任意のノートを
    /// 「版」として覗ける
    #[test]
    fn test_version_in_history_そのノートの履歴フォルダの中だけ受ける() {
        let (root, _vault) = temp_vault();
        let root_str = root.path().to_str().unwrap();
        let note = root.path().join("a.md");
        std::fs::write(&note, "# a\n").unwrap();
        let store = history_root(root_str);
        let key = history_key(root_str, &note);
        let kept = history::keep(
            &store,
            &key,
            "# a 旧\n",
            chrono::Local::now().naive_local(),
            true,
            0,
        )
        .unwrap()
        .expect("版が残る");
        assert!(version_in_history(root_str, &note, &kept).is_ok());
        // 別のノートを版として渡すと断る
        let other = root.path().join("b.md");
        std::fs::write(&other, "# b\n").unwrap();
        assert!(version_in_history(root_str, &note, &other).is_err());
    }

    #[test]
    fn test_restore_version_今の内容を残してから版を書き戻す() {
        let (root, _vault) = temp_vault();
        let root_str = root.path().to_str().unwrap();
        let note = root.path().join("a.md");
        std::fs::write(&note, "新\n").unwrap();
        let store = history_root(root_str);
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        let kept = history::keep(&store, "path:a.md", "旧\n", at, true, 0)
            .unwrap()
            .unwrap();
        let restored = restore_version(root_str, &note, &kept).unwrap();
        assert_eq!(restored, "旧\n");
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "旧\n");
        // 戻す前の「新」が版として残る（取り消せない操作を増やさない）
        let versions = history::versions(&store, "path:a.md");
        assert_eq!(versions.len(), 2);
        assert_eq!(std::fs::read_to_string(&versions[0].path).unwrap(), "新\n");
        // 別のノートの版は書き戻せない
        let other = root.path().join("b.md");
        std::fs::write(&other, "b\n").unwrap();
        assert!(restore_version(root_str, &other, &kept).is_err());
    }

    #[test]
    fn test_restore_version_今の内容を版に残せなければ書き戻さない() {
        // 戻す前の版が残らないまま書き戻すと、今の本文はどこにも無くなる。
        // doc コメントの約束（取り消せない操作を増やさない）どおり止める
        // （レビュー 2026-09-23）
        let (root, vault) = temp_vault();
        let root_str = root.path().to_str().unwrap();
        let note = root.path().join("a.md");
        std::fs::write(&note, "新\n").unwrap();
        let store = history_root(root_str);
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        let kept = history::keep(&store, "path:a.md", "旧\n", at, true, 0)
            .unwrap()
            .unwrap();

        let _locked = crate::test_support::lock_history(&vault);
        assert!(restore_version(root_str, &note, &kept).is_err());
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "新\n");
    }
}
