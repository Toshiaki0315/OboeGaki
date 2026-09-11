// 改名に合わせて他のノートの `[[リンク]]` を書き換える（ADR-0053、TASKS 12-1）。
//
// 対象は索引の links 表（backlinks）で引く。1 件ずつ読んで純関数で書き換え、
// 変わったものだけ save_atomic で書く。書き込みは外部変更の流れに乗る。
// 失敗した名前は集めて返し、改名そのものは戻さない（ADR-0053）。

use std::path::PathBuf;

use crate::index_db::IndexDb;
use crate::vault::{read_note, Vault};

/// 書き換えの結果。`paths` は書いたノート（監視の抑制に使う）
#[derive(Debug, Default)]
pub struct RewriteOutcome {
    pub rewritten: usize,
    /// 置き換えた箇所の数（rewrite_all。リンクの書き換えでは使わない）
    pub occurrences: usize,
    pub paths: Vec<PathBuf>,
    pub failed: Vec<String>,
}

/// 全ノートを走査し、`edit` が Some を返したものを書き換える（ADR-0055 の
/// 「まとめて書き換える」土台）。`db` が None なら**数えるだけ**（書かない —
/// 置換の前に件数を見せる用）。1 件の失敗で止めず、名前を集めて返す
pub fn rewrite_all(
    vault: &Vault,
    mut db: Option<&mut IndexDb>,
    edit: impl Fn(&str) -> Option<(String, usize)>,
) -> RewriteOutcome {
    let mut outcome = RewriteOutcome::default();
    for absolute in vault.scan() {
        let relative = absolute
            .strip_prefix(vault.root())
            .unwrap_or(&absolute)
            .to_string_lossy()
            .into_owned();
        let text = match read_note(&absolute) {
            Ok(text) => text,
            Err(error) => {
                outcome.failed.push(format!("{relative}: {error}"));
                continue;
            }
        };
        let Some((rewritten, count)) = edit(&text) else {
            continue;
        };
        if let Some(db) = db.as_deref_mut() {
            if let Err(error) = crate::autosave::save_atomic(&absolute, &rewritten) {
                outcome.failed.push(format!("{relative}: {error}"));
                continue;
            }
            if let Err(error) = db.upsert(vault, &absolute) {
                eprintln!("索引の更新に失敗した: {error}");
            }
        }
        outcome.rewritten += 1;
        outcome.occurrences += count;
        outcome.paths.push(absolute);
    }
    outcome
}

/// `old` を指しているノートの `[[old]]` を `new` に書き換える。
pub fn rewrite_links_to(vault: &Vault, db: &mut IndexDb, old: &str, new: &str) -> RewriteOutcome {
    let mut outcome = RewriteOutcome::default();
    let referrers = match db.backlinks(old) {
        Ok(found) => found,
        Err(error) => {
            outcome.failed.push(format!("索引を引けなかった: {error}"));
            return outcome;
        }
    };
    let mut seen = std::collections::HashSet::new();
    for referrer in referrers {
        if !seen.insert(referrer.path.clone()) {
            continue; // 同じノートが続柄の違いで複数行になる
        }
        let absolute = vault.root().join(&referrer.path);
        let text = match read_note(&absolute) {
            Ok(text) => text,
            Err(error) => {
                outcome.failed.push(format!("{}: {error}", referrer.path));
                continue;
            }
        };
        let Some(rewritten) = crate::wikilink::rewrite_wikilinks(&text, old, new) else {
            continue;
        };
        if let Err(error) = crate::autosave::save_atomic(&absolute, &rewritten) {
            outcome.failed.push(format!("{}: {error}", referrer.path));
            continue;
        }
        if let Err(error) = db.upsert(vault, &absolute) {
            eprintln!("索引の更新に失敗した: {error}");
        }
        outcome.rewritten += 1;
        outcome.paths.push(absolute);
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index_db::IndexDb;
    use crate::vault::Vault;
    use std::fs;
    use tempfile::TempDir;

    fn note(root: &std::path::Path, name: &str, text: &str) {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// 実機 2026-09-11: 改名しても「1 件のノートのリンクを直しました」が出な
    /// かった。アプリの索引は自動保存の upsert で育つ（sync ではない）ので、
    /// その経路で backlinks が引けることを確かめる
    #[test]
    fn test_rewrite_all_全ノートを走査して書き換え_数を返す_索引も追う() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "a.md", "旧い話\n");
        note(root.path(), "仕事/b.md", "旧い\n旧い\n");
        note(root.path(), "c.md", "関係ない\n");
        let mut db = IndexDb::open(&vault.managed_dir()).unwrap();
        db.sync(&vault).unwrap();

        // 数えるだけ（書かない）
        let preview = rewrite_all(&vault, None, |text| {
            crate::text_rewrite::replace_outside_code(text, "旧い", "新しい", true, false)
        });
        assert_eq!((preview.rewritten, preview.occurrences), (2, 3));
        assert_eq!(
            fs::read_to_string(root.path().join("a.md")).unwrap(),
            "旧い話\n"
        );

        let outcome = rewrite_all(&vault, Some(&mut db), |text| {
            crate::text_rewrite::replace_outside_code(text, "旧い", "新しい", true, false)
        });
        assert_eq!((outcome.rewritten, outcome.occurrences), (2, 3));
        assert_eq!(
            fs::read_to_string(root.path().join("a.md")).unwrap(),
            "新しい話\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("仕事/b.md")).unwrap(),
            "新しい\n新しい\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("c.md")).unwrap(),
            "関係ない\n"
        );
        assert!(outcome.paths.iter().any(|p| p.ends_with("a.md")));
        // 索引の全文検索も新しい語で当たる
        assert!(!db.search("新しい").unwrap().is_empty());
    }

    #[test]
    fn test_rewrite_links_to_自動保存の_upsert_で育てた索引でも引ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let mut db = IndexDb::open(&vault.managed_dir()).unwrap();
        db.sync(&vault).unwrap(); // 空で開いた
        note(root.path(), "99_テスト/会議メモ.md", "# 会議メモ\n");
        db.upsert(&vault, &root.path().join("99_テスト/会議メモ.md"))
            .unwrap();
        note(
            root.path(),
            "99_テスト/A.md",
            "# A\n\n[[会議メモ]] を見よ\n",
        );
        db.upsert(&vault, &root.path().join("99_テスト/A.md"))
            .unwrap();

        let outcome = rewrite_links_to(&vault, &mut db, "会議メモ", "定例");

        assert_eq!(outcome.rewritten, 1, "{:?}", outcome.failed);
        assert_eq!(
            fs::read_to_string(root.path().join("99_テスト/A.md")).unwrap(),
            "# A\n\n[[定例]] を見よ\n"
        );
    }

    #[test]
    fn test_rewrite_links_to_指しているノートだけ書き換え_件数を返す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "会議メモ.md", "# 会議メモ\n");
        note(root.path(), "入口.md", "[[会議メモ]] を見よ\n");
        note(
            root.path(),
            "仕事/予定.md",
            "- 参考: [[会議メモ]]\n- [[別]]\n",
        );
        note(root.path(), "無関係.md", "何も指さない\n");
        let mut db = IndexDb::open(&vault.managed_dir()).unwrap();
        db.sync(&vault).unwrap();

        let outcome = rewrite_links_to(&vault, &mut db, "会議メモ", "定例");

        assert_eq!(outcome.rewritten, 2);
        assert!(outcome.failed.is_empty());
        assert_eq!(
            fs::read_to_string(root.path().join("入口.md")).unwrap(),
            "[[定例]] を見よ\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("仕事/予定.md")).unwrap(),
            "- 参考: [[定例]]\n- [[別]]\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("無関係.md")).unwrap(),
            "何も指さない\n"
        );
        // 索引も新しい名前を指している
        assert_eq!(db.backlinks("定例").unwrap().len(), 2);
        assert!(db.backlinks("会議メモ").unwrap().is_empty());
    }
}
