//! GUI（commands/）と MCP（mcp/）が別々に組んでいた読み系の操作を 1 本に
//! （19-5。2026-09-18）。**相対パスと索引の行で考え、絶対パスの門・無視リスト・
//! 切り詰め・索引の後追いは呼ぶ側**（GUI は Suppressor と索引の更新、MCP は
//! IgnoreList と clip）が被せる。`keep` は「そのノート／フォルダを数えるか」

use std::collections::HashMap;
use std::path::Path;

use crate::history::{self, Version};
use crate::index_db::{IndexDb, NoteMeta};
use crate::vault::Vault;

/// 一覧。folder は vault からの相対（None で全部、Some("") で直下）、tag は
/// そのタグ（配下も）を持つもの。両方あれば両方で絞る
pub fn list_notes(
    db: &IndexDb,
    folder: Option<&str>,
    tag: Option<&str>,
) -> rusqlite::Result<Vec<NoteMeta>> {
    let mut rows = match (folder, tag) {
        (_, Some(tag)) => db.notes_with_tag(tag)?,
        (Some(folder), None) => db.notes_in_folder(folder)?,
        (None, None) => db.list_notes()?,
    };
    if let (Some(folder), Some(_)) = (folder, tag) {
        let cleaned = folder.trim_matches('/');
        rows.retain(|row| parent_of(&row.path) == cleaned);
    }
    Ok(rows)
}

/// フォルダと**直下の**ノート件数。先頭は直下（空文字）、続きは vault の並び
/// （名前順で深さ優先）。**存在はディスク、件数は索引**（索引にあってディスクに
/// 無いものは出さない）。`keep` に落とされたノートは数えず、フォルダも並べない
pub fn folders_with_counts(
    vault: &Vault,
    db: &IndexDb,
    keep: impl Fn(&str) -> bool,
) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut counts: HashMap<String, i64> = HashMap::new();
    for row in db.list_notes()? {
        if !keep(&row.path) {
            continue;
        }
        *counts.entry(parent_of(&row.path).to_string()).or_insert(0) += 1;
    }
    let count_of = |folder: &str| counts.get(folder).copied().unwrap_or(0);
    let mut found = vec![(String::new(), count_of(""))];
    for folder in vault.folders() {
        if !keep(&folder) {
            continue;
        }
        let count = count_of(&folder);
        found.push((folder, count));
    }
    Ok(found)
}

/// タグと件数（使われている順、同数なら名前順）。`keep` に落とされたノートの
/// タグは数えない — 索引の集計を素通しすると、隠したノートにしか無いタグが
/// その存在ごと漏れる
pub fn tags_with_counts(
    db: &IndexDb,
    keep: impl Fn(&str) -> bool,
) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut counts: HashMap<String, i64> = HashMap::new();
    for (path, tag) in db.tag_uses()? {
        if keep(&path) {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    let mut tags: Vec<(String, i64)> = counts.into_iter().collect();
    tags.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(tags)
}

/// そのノートの版（新しい順）。鍵の字面は vault の 1 本に任せる
pub fn versions(vault: &Vault, note: &Path) -> Vec<Version> {
    let store = history::store_root(&vault.managed_dir());
    history::versions(&store, &vault.history_key(note))
}

/// 時刻の字面で名指した版（一覧と同じ `Version::stamp`）
pub fn version_at(vault: &Vault, note: &Path, stamp: &str) -> Option<Version> {
    versions(vault, note)
        .into_iter()
        .find(|version| version.stamp() == stamp)
}

fn parent_of(relative: &str) -> &str {
    relative
        .rsplit_once('/')
        .map(|(head, _)| head)
        .unwrap_or("")
}

#[cfg(test)]
// テスト名は日本語で書く。固有名を小文字に崩さないため、snake_case の警告は
// この mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{note, temp_vault};

    fn synced(vault: &Vault) -> IndexDb {
        let mut db = IndexDb::open(&vault.managed_dir()).unwrap();
        db.sync(vault).unwrap();
        db
    }

    fn paths(rows: &[NoteMeta]) -> Vec<&str> {
        let mut found: Vec<&str> = rows.iter().map(|r| r.path.as_str()).collect();
        found.sort();
        found
    }

    fn sample() -> (tempfile::TempDir, Vault) {
        let (root, vault) = temp_vault();
        note(root.path(), "a.md", "# a\n#仕事\n");
        note(root.path(), "仕事/b.md", "# b\n#仕事 #急ぎ\n");
        note(root.path(), "仕事/奥/c.md", "# c\n#急ぎ\n");
        note(root.path(), "秘密/d.md", "# d\n#秘密\n");
        (root, vault)
    }

    #[test]
    fn test_list_notes_フォルダとタグで絞り_両方なら両方() {
        let (_root, vault) = sample();
        let db = synced(&vault);
        assert_eq!(paths(&list_notes(&db, None, None).unwrap()).len(), 4);
        assert_eq!(
            paths(&list_notes(&db, Some("仕事"), None).unwrap()),
            ["仕事/b.md"]
        );
        assert_eq!(
            paths(&list_notes(&db, None, Some("急ぎ")).unwrap()),
            ["仕事/b.md", "仕事/奥/c.md"]
        );
        assert_eq!(
            paths(&list_notes(&db, Some("仕事"), Some("急ぎ")).unwrap()),
            ["仕事/b.md"]
        );
    }

    #[test]
    fn test_folders_with_counts_直下が先頭_件数は直下だけ_落としたものは数えず並べない() {
        let (_root, vault) = sample();
        let db = synced(&vault);
        let all = folders_with_counts(&vault, &db, |_| true).unwrap();
        assert_eq!(all[0], (String::new(), 1));
        assert!(all.contains(&("仕事".to_string(), 1)));
        assert!(all.contains(&("仕事/奥".to_string(), 1)));
        assert!(all.contains(&("秘密".to_string(), 1)));
        let visible = folders_with_counts(&vault, &db, |path| !path.starts_with("秘密")).unwrap();
        assert!(!visible.iter().any(|(folder, _)| folder == "秘密"));
        assert_eq!(visible.len(), all.len() - 1);
    }

    #[test]
    fn test_tags_with_counts_使われている順_落としたノートのタグは数えない() {
        let (_root, vault) = sample();
        let db = synced(&vault);
        let all = tags_with_counts(&db, |_| true).unwrap();
        assert_eq!(all[0], ("仕事".to_string(), 2));
        assert!(all.contains(&("秘密".to_string(), 1)));
        // 索引の集計（tag_list）と同じ答え
        assert_eq!(all, db.tag_list().unwrap());
        let visible = tags_with_counts(&db, |path| !path.starts_with("秘密")).unwrap();
        assert!(!visible.iter().any(|(tag, _)| tag == "秘密"));
    }

    #[test]
    fn test_versions_と_version_at_は一覧と同じ字面で引ける() {
        let (root, vault) = sample();
        let path = root.path().join("a.md");
        let store = history::store_root(&vault.managed_dir());
        let key = vault.history_key(&path);
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 18)
            .unwrap()
            .and_hms_opt(9, 30, 0)
            .unwrap();
        history::keep(&store, &key, "古い", at, true, 0).unwrap();
        let found = versions(&vault, &path);
        assert_eq!(found.len(), 1);
        let stamp = found[0].stamp();
        assert_eq!(stamp, "2026-09-18 09:30:00");
        assert!(version_at(&vault, &path, &stamp).is_some());
        assert!(version_at(&vault, &path, "2000-01-01 00:00:00").is_none());
    }
}
