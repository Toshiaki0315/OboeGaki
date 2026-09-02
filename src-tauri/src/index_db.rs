// SQLite FTS5 索引と全文検索（spec §7.3）。参照実装 storage/index_db.py の移植。
//
// `.OboeGaki/index.sqlite` は**捨ててよいキャッシュ**（T7）。削除しても
// `.md` から sync() で完全再構築できる。真実は常にファイル側にある。
//
// 日本語検索の設計（spec §7.3）:
//   - tokenize='trigram'。3 文字ずつの重なりで索引するため、日本語の
//     部分一致が形態素解析なしで動く
//   - trigram は 2 文字以下のクエリにヒットしない（「人事」「経費」等）ので、
//     3 文字未満は notes.title/preview への LIKE にフォールバックする
//
// スキーマは参照実装の必要部分から育てる方針（ULID id・tags・links・pinned は
// 該当機能を移植するときに足す。索引は捨てられるので移行も作り直しでよい）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::Connection;

use crate::vault::Vault;

pub const INDEX_FILE: &str = "index.sqlite";
/// この文字数以上なら trigram FTS、未満なら LIKE フォールバック。
const FTS_MIN_CHARS: usize = 3;
const SEARCH_LIMIT: usize = 50;
/// 一覧に出す本文の頭。参照実装 core/document.py の preview と同じ 200 文字。
const PREVIEW_CHARS: usize = 200;

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

/// 本文の頭 200 文字（front matter と先頭の H1 を除く）。
pub fn note_preview(text: &str) -> String {
    let mut lines = text.lines().peekable();
    // front matter: 先頭が `---` 行なら、次の `---` 行まで読み飛ばす
    if lines.peek().map(|l| l.trim_end()) == Some("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim_end() == "---" {
                break;
            }
        }
    }
    let mut body: Vec<&str> = Vec::new();
    let mut h1_skipped = false;
    for line in lines {
        if body.is_empty() {
            if line.trim().is_empty() {
                continue;
            }
            if !h1_skipped && line.starts_with("# ") {
                h1_skipped = true;
                continue;
            }
        }
        body.push(line);
    }
    let collapsed = body.join(" ");
    let normalized = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(PREVIEW_CHARS).collect()
}

fn mtime_ns(meta: &fs::Metadata) -> i64 {
    use std::os::unix::fs::MetadataExt;
    meta.mtime() * 1_000_000_000 + meta.mtime_nsec()
}

/// 1 ファイルを索引に入れる（sync と upsert の共通部）。
/// 読めないファイルは黙って飛ばす。
fn index_one(tx: &rusqlite::Transaction, root: &Path, absolute: &Path) -> rusqlite::Result<()> {
    let Ok(relative) = absolute.strip_prefix(root) else {
        return Ok(());
    };
    let relative = relative.to_string_lossy().into_owned();
    let (Ok(meta), Ok(text)) = (fs::metadata(absolute), fs::read_to_string(absolute)) else {
        return Ok(());
    };
    let title = absolute
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(crate::vault::UNTITLED)
        .to_string();
    let preview = note_preview(&text);
    tx.execute(
        "INSERT INTO notes(path, title, preview, mtime_ns, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE
         SET title = ?2, preview = ?3, mtime_ns = ?4, size_bytes = ?5",
        rusqlite::params![relative, title, preview, mtime_ns(&meta), meta.len() as i64],
    )?;
    tx.execute("DELETE FROM notes_fts WHERE path = ?1", [&relative])?;
    tx.execute(
        "INSERT INTO notes_fts(title, body, path) VALUES (?1, ?2, ?3)",
        rusqlite::params![title, text, relative],
    )?;
    Ok(())
}

pub struct IndexDb {
    conn: Connection,
}

impl IndexDb {
    /// 管理フォルダの中の索引を開く（無ければ作る）。
    pub fn open(managed_dir: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(managed_dir.join(INDEX_FILE))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                path       TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                preview    TEXT NOT NULL,
                mtime_ns   INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                title,
                body,
                path UNINDEXED,
                tokenize = 'trigram'
            );",
        )?;
        Ok(Self { conn })
    }

    /// vault と索引の差分同期。(mtime_ns, size_bytes) が一致する行は触らない。
    /// 読めないファイルは飛ばす（1 つのせいで全体を止めない）。
    pub fn sync(&mut self, vault: &Vault) -> rusqlite::Result<()> {
        let root = vault.root().to_path_buf();
        let mut existing: HashMap<String, (i64, i64)> = HashMap::new();
        {
            let mut statement = self
                .conn
                .prepare("SELECT path, mtime_ns, size_bytes FROM notes")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?))
            })?;
            for row in rows {
                let (path, mtime, size) = row?;
                existing.insert(path, (mtime, size));
            }
        }
        let tx = self.conn.transaction()?;
        let mut seen: HashSet<String> = HashSet::new();
        for absolute in vault.scan() {
            let Ok(relative) = absolute.strip_prefix(&root) else {
                continue;
            };
            let relative = relative.to_string_lossy().into_owned();
            let Ok(meta) = fs::metadata(&absolute) else {
                continue;
            };
            let mtime = mtime_ns(&meta);
            let size = meta.len() as i64;
            seen.insert(relative.clone());
            if existing.get(&relative) == Some(&(mtime, size)) {
                continue; // 変わっていない
            }
            index_one(&tx, &root, &absolute)?;
        }
        for gone in existing.keys().filter(|path| !seen.contains(*path)) {
            tx.execute("DELETE FROM notes WHERE path = ?1", [gone])?;
            tx.execute("DELETE FROM notes_fts WHERE path = ?1", [gone])?;
        }
        tx.commit()
    }

    /// 1 ファイルだけ索引を更新する（自動保存の後追い用）。
    /// 全体の整合は vault_open 時の sync が取り直すので、ここは速さ優先。
    pub fn upsert(&mut self, vault: &Vault, absolute: &Path) -> rusqlite::Result<()> {
        let root = vault.root().to_path_buf();
        let tx = self.conn.transaction()?;
        index_one(&tx, &root, absolute)?;
        tx.commit()
    }

    /// ハイブリッド検索。返りは vault からの相対パス。
    pub fn search(&self, query: &str) -> rusqlite::Result<Vec<SearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        if trimmed.chars().count() >= FTS_MIN_CHARS {
            // フレーズとして引用符で包む（FTS クエリ構文の注入を避ける）
            let phrase = format!("\"{}\"", trimmed.replace('"', "\"\""));
            let mut statement = self.conn.prepare(
                "SELECT path, title, snippet(notes_fts, 1, '', '', '…', 12)
                 FROM notes_fts WHERE notes_fts MATCH ?1
                 ORDER BY rank LIMIT ?2",
            )?;
            let rows =
                statement.query_map(rusqlite::params![phrase, SEARCH_LIMIT as i64], |row| {
                    Ok(SearchHit {
                        path: row.get(0)?,
                        title: row.get(1)?,
                        snippet: row.get(2)?,
                    })
                })?;
            rows.collect()
        } else {
            // trigram は 2 文字以下にヒットしないので LIKE に切り替える
            let escaped = trimmed
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let like = format!("%{escaped}%");
            let mut statement = self.conn.prepare(
                "SELECT path, title, preview FROM notes
                 WHERE title LIKE ?1 ESCAPE '\\' OR preview LIKE ?1 ESCAPE '\\'
                 ORDER BY title LIMIT ?2",
            )?;
            let rows =
                statement.query_map(rusqlite::params![like, SEARCH_LIMIT as i64], |row| {
                    Ok(SearchHit {
                        path: row.get(0)?,
                        title: row.get(1)?,
                        snippet: row.get(2)?,
                    })
                })?;
            rows.collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn vault_with(notes: &[(&str, &str)]) -> (TempDir, Vault) {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        for (name, text) in notes {
            let path = root.path().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, text).unwrap();
        }
        (root, vault)
    }

    fn synced(vault: &Vault) -> IndexDb {
        let mut db = IndexDb::open(&vault.managed_dir()).unwrap();
        db.sync(vault).unwrap();
        db
    }

    fn paths(hits: &[SearchHit]) -> Vec<&str> {
        hits.iter().map(|h| h.path.as_str()).collect()
    }

    #[test]
    fn test_preview_front_matterと先頭のh1を除いた頭を返す() {
        let text = "---\ntags: [a]\n---\n# 題名\n\n本文の一行目。\n二行目。\n";
        assert_eq!(note_preview(text), "本文の一行目。 二行目。");
    }

    #[test]
    fn test_preview_200文字で切る() {
        let text = "あ".repeat(300);
        assert_eq!(note_preview(&text), "あ".repeat(200));
    }

    #[test]
    fn test_search_日本語の部分一致が3文字以上で見つかる() {
        let (_root, vault) = vault_with(&[
            (
                "会議.md",
                "# 会議\n\n新しい検索機能の設計について話した。\n",
            ),
            ("日記.md", "# 日記\n\n今日は晴れ。\n"),
        ]);
        let db = synced(&vault);
        assert_eq!(paths(&db.search("検索機能").unwrap()), vec!["会議.md"]);
        assert_eq!(db.search("存在しない語").unwrap(), vec![]);
    }

    #[test]
    fn test_search_2文字はlikeフォールバックで題名と頭に当たる() {
        let (_root, vault) = vault_with(&[
            ("人事.md", "# 人事\n\n評価面談の準備。\n"),
            ("経費のメモ.md", "# 経費のメモ\n\n精算は月末。\n"),
            ("無関係.md", "# 無関係\n\n何もない。\n"),
        ]);
        let db = synced(&vault);
        assert_eq!(paths(&db.search("人事").unwrap()), vec!["人事.md"]);
        assert_eq!(paths(&db.search("経費").unwrap()), vec!["経費のメモ.md"]);
        assert_eq!(paths(&db.search("面談").unwrap()), vec!["人事.md"]);
    }

    #[test]
    fn test_search_サブフォルダのノートも相対パスで返る() {
        let (_root, vault) =
            vault_with(&[("日記/2026-09-03.md", "# 今日\n\n望遠鏡を組み立てた。\n")]);
        let db = synced(&vault);
        assert_eq!(
            paths(&db.search("望遠鏡を組み立て").unwrap()),
            vec!["日記/2026-09-03.md"]
        );
    }

    #[test]
    fn test_sync_変更と削除が反映される() {
        let (root, vault) = vault_with(&[("a.md", "# a\n\n初版の内容。\n")]);
        let mut db = synced(&vault);

        // 変更
        fs::write(root.path().join("a.md"), "# a\n\n改訂した中身。\n").unwrap();
        db.sync(&vault).unwrap();
        assert_eq!(paths(&db.search("改訂した中身").unwrap()), vec!["a.md"]);
        assert_eq!(db.search("初版の内容").unwrap(), vec![]);

        // 削除
        fs::remove_file(root.path().join("a.md")).unwrap();
        db.sync(&vault).unwrap();
        assert_eq!(db.search("改訂した中身").unwrap(), vec![]);
    }

    #[test]
    fn test_索引を消しても再構築できる() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n消しても戻る索引。\n")]);
        {
            let _db = synced(&vault);
        }
        let index_path: PathBuf = vault.managed_dir().join(INDEX_FILE);
        fs::remove_file(&index_path).unwrap();

        let db = synced(&vault); // 作り直し
        assert_eq!(paths(&db.search("消しても戻る").unwrap()), vec!["a.md"]);
    }

    #[test]
    fn test_upsert_1ファイルだけ索引を更新する() {
        let (root, vault) = vault_with(&[("a.md", "# a\n\n最初の中身。\n")]);
        let mut db = synced(&vault);
        let path = root.path().join("a.md");
        fs::write(&path, "# a\n\n差し替えた中身。\n").unwrap();

        db.upsert(&vault, &path).unwrap();

        assert_eq!(paths(&db.search("差し替えた中身").unwrap()), vec!["a.md"]);
    }

    #[test]
    fn test_search_空クエリは何も返さない() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n本文。\n")]);
        let db = synced(&vault);
        assert_eq!(db.search("").unwrap(), vec![]);
        assert_eq!(db.search("   ").unwrap(), vec![]);
    }
}
