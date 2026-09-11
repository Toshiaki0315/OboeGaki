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
    pub paths: Vec<PathBuf>,
    pub failed: Vec<String>,
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
