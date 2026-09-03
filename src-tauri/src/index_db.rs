// SQLite FTS5 索引と全文検索（spec §7.3）。参照実装 storage/index_db.py の移植。
//
// `.OboeGaki/index.sqlite` は**捨ててよいキャッシュ**（T7）。削除しても
// `.md` から sync() で完全再構築できる。真実は常にファイル側にある。
//
// 日本語検索の設計（spec §7.3）:
//   - tokenize='trigram'。3 文字ずつの重なりで索引するため、日本語の
//     部分一致が形態素解析なしで動く
//   - trigram は 2 文字以下のクエリにヒットしない（「人事」「経費」等）ので、
//     3 文字未満は notes.title/preview/path への LIKE にフォールバックする
//   - パス（フォルダ名）も検索対象。「日記」フォルダのノートは「日記」で
//     見つかるべき（実機フィードバック 2026-09-03）
//
// スキーマは参照実装の必要部分から育てる方針（ULID id・tags・links・pinned は
// 該当機能を移植するときに足す。索引は捨てられるので移行も作り直しでよい）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::Connection;

use crate::vault::Vault;

pub const INDEX_FILE: &str = "index.sqlite";
/// スキーマの世代。合わない索引は**丸ごと捨てて作り直す**（T7: 索引は
/// 捨ててよいキャッシュなので、移行コードを書くより作り直しが正しい）。
/// 2: notes_fts の path を索引対象にし、LIKE フォールバックにも path を足した
/// 3: tags テーブルを追加（サイドバーのタグ一覧）
/// 5: links テーブルを追加（バックリンク。E-6）
const SCHEMA_VERSION: i64 = 5;
/// この文字数以上なら trigram FTS、未満なら LIKE フォールバック。
const FTS_MIN_CHARS: usize = 3;
const SEARCH_LIMIT: usize = 50;
/// 一覧に出す本文の頭。参照実装 core/document.py の preview と同じ 200 文字。
const PREVIEW_CHARS: usize = 200;

/// 一覧に出すノートの素材（ADR-0022 系の一覧強化）。
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct NoteMeta {
    /// vault からの相対パス
    pub path: String,
    pub title: String,
    pub preview: String,
    /// ミリ秒（JS の Date と突き合わせやすい単位）
    pub mtime_ms: i64,
    /// front matter の `pinned: true`（spec §7.3。一覧の先頭固定）
    pub pinned: bool,
}

/// バックリンクの 1 件（E-6）。`context` は**指している行**そのもの。
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Backlink {
    /// vault からの相対パス
    pub path: String,
    pub title: String,
    pub context: String,
}

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
    let pinned = crate::front_matter::pinned(&text);
    tx.execute(
        "INSERT INTO notes(path, title, preview, mtime_ns, size_bytes, pinned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE
         SET title = ?2, preview = ?3, mtime_ns = ?4, size_bytes = ?5, pinned = ?6",
        rusqlite::params![
            relative,
            title,
            preview,
            mtime_ns(&meta),
            meta.len() as i64,
            pinned
        ],
    )?;
    tx.execute("DELETE FROM notes_fts WHERE path = ?1", [&relative])?;
    tx.execute(
        "INSERT INTO notes_fts(title, path, body) VALUES (?1, ?2, ?3)",
        rusqlite::params![title, relative, text],
    )?;
    tx.execute("DELETE FROM tags WHERE path = ?1", [&relative])?;
    for tag in crate::tags::extract_tags(&text) {
        tx.execute(
            "INSERT OR IGNORE INTO tags(path, tag) VALUES (?1, ?2)",
            rusqlite::params![relative, tag],
        )?;
    }
    // 指しているノート（E-6）。**行き先の有無は問わない** — まだ無いノートへの
    // リンクも、作られた瞬間に繋がるべきもの（ADR-0011）
    tx.execute("DELETE FROM links WHERE path = ?1", [&relative])?;
    for target in crate::wikilink::links(&text) {
        let context = crate::wikilink::context_line(&text, &target);
        tx.execute(
            "INSERT OR IGNORE INTO links(path, target, context) VALUES (?1, ?2, ?3)",
            rusqlite::params![relative, target, context],
        )?;
    }
    Ok(())
}

pub struct IndexDb {
    conn: Connection,
}

impl IndexDb {
    /// 管理フォルダの中の索引を開く（無ければ作る）。
    /// スキーマの世代が合わなければ捨てて作り直す（次の sync が埋め直す）。
    pub fn open(managed_dir: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(managed_dir.join(INDEX_FILE))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // 背景同期と watcher の更新が同時に走っても SQLITE_BUSY で落とさない
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version != SCHEMA_VERSION {
            conn.execute_batch(
                "DROP TABLE IF EXISTS notes;
                 DROP TABLE IF EXISTS notes_fts;
                 DROP TABLE IF EXISTS tags;
                 DROP TABLE IF EXISTS links;",
            )?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                path       TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                preview    TEXT NOT NULL,
                mtime_ns   INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                pinned     INTEGER NOT NULL DEFAULT 0
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                title,
                path,
                body,
                tokenize = 'trigram'
            );
            CREATE TABLE IF NOT EXISTS tags (
                path TEXT NOT NULL,
                tag  TEXT NOT NULL,
                PRIMARY KEY (path, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
            CREATE TABLE IF NOT EXISTS links (
                path    TEXT NOT NULL,
                target  TEXT NOT NULL,
                context TEXT NOT NULL,
                PRIMARY KEY (path, target)
            );
            CREATE INDEX IF NOT EXISTS idx_links_target ON links(target COLLATE NOCASE);",
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
            tx.execute("DELETE FROM tags WHERE path = ?1", [gone])?;
            tx.execute("DELETE FROM links WHERE path = ?1", [gone])?;
        }
        tx.commit()
    }

    /// 一覧の素材を返す。並び順はフロント側の持ち物（設定で切り替える）。
    pub fn list_notes(&self) -> rusqlite::Result<Vec<NoteMeta>> {
        let mut statement = self
            .conn
            .prepare("SELECT path, title, preview, mtime_ns, pinned FROM notes")?;
        let rows = statement.query_map([], |row| {
            Ok(NoteMeta {
                path: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                mtime_ms: row.get::<_, i64>(3)? / 1_000_000,
                pinned: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    /// 1 ファイルを索引から外す（ゴミ箱移動・改名の旧パス・外部削除）。
    pub fn remove(&mut self, vault: &Vault, absolute: &Path) -> rusqlite::Result<()> {
        let Ok(relative) = absolute.strip_prefix(vault.root()) else {
            return Ok(());
        };
        let relative = relative.to_string_lossy().into_owned();
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM notes WHERE path = ?1", [&relative])?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1", [&relative])?;
        tx.execute("DELETE FROM tags WHERE path = ?1", [&relative])?;
        tx.execute("DELETE FROM links WHERE path = ?1", [&relative])?;
        tx.commit()
    }

    /// タグと件数（多い順 → 名前順）。サイドバーのタグ一覧の素材。
    pub fn tag_list(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let mut statement = self.conn.prepare(
            "SELECT tag, COUNT(*) AS uses FROM tags
             GROUP BY tag ORDER BY uses DESC, tag ASC",
        )?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// そのタグ、または配下のタグ（`work` に対する `work/会議`）を持つノート。
    /// サイドバーのタグクリックはこれで絞る — 全文検索で `#work` を探すと
    /// 本文に「#workshop」と書いただけのノートまで拾ってしまう（C-4）。
    ///
    /// tags 表には本文に現れたタグだけを入れてある（祖先は入れない。タグ一覧に
    /// 本文のどこにも無い名前が並ぶのを避けるため）ので、配下は前方一致で拾う。
    pub fn notes_with_tag(&self, tag: &str) -> rusqlite::Result<Vec<NoteMeta>> {
        let normalized = crate::tags::normalize(tag);
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        // LIKE のメタ文字（% _ \）はタグ名に入りうるので必ず退避する
        let escaped = normalized
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let descendants = format!("{escaped}/%");
        let mut statement = self.conn.prepare(
            "SELECT notes.path, notes.title, notes.preview, notes.mtime_ns, notes.pinned
             FROM notes JOIN tags ON tags.path = notes.path
             WHERE tags.tag = ?1 OR tags.tag LIKE ?2 ESCAPE '\\'
             GROUP BY notes.path",
        )?;
        let rows = statement.query_map(rusqlite::params![normalized, descendants], |row| {
            Ok(NoteMeta {
                path: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                mtime_ms: row.get::<_, i64>(3)? / 1_000_000,
                pinned: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    /// そのフォルダ**直下**のノート（ADR-0024 追記 4）。
    ///
    /// **子孫は含めない。** ルートだけ非再帰でサブフォルダは再帰、という
    /// 食い違いを避ける。Finder と同じで、選んだフォルダの中身が出る。
    /// 空文字は直下。
    pub fn notes_in_folder(&self, folder: &str) -> rusqlite::Result<Vec<NoteMeta>> {
        let cleaned = folder.trim_matches('/');
        let sql = if cleaned.is_empty() {
            "SELECT path, title, preview, mtime_ns, pinned FROM notes
             WHERE instr(path, '/') = 0"
        } else {
            // 区切りまで含めて前方一致する（`仕事` で `仕事場/` を拾わない）。
            // 残りに区切りが無いものだけが直下
            "SELECT path, title, preview, mtime_ns, pinned FROM notes
             WHERE substr(path, 1, length(?1) + 1) = ?1 || '/'
               AND instr(substr(path, length(?1) + 2), '/') = 0"
        };
        let mut statement = self.conn.prepare(sql)?;
        let to_meta = |row: &rusqlite::Row| {
            Ok(NoteMeta {
                path: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                mtime_ms: row.get::<_, i64>(3)? / 1_000_000,
                pinned: row.get(4)?,
            })
        };
        let rows = if cleaned.is_empty() {
            statement.query_map([], to_meta)?
        } else {
            statement.query_map([cleaned], to_meta)?
        };
        rows.collect()
    }

    /// フォルダごとのノート件数（**直下だけ**）。空文字の項目は直下。
    ///
    /// 件数は索引（速い）、フォルダの存在はディスク（`Vault::folders`）が
    /// 決める（ADR-0024 追記 1。索引にあってディスクに無いものは出さない）。
    /// パスの組み立ては SQL でやらずこちらで数える — ノート数ぶんの文字列
    /// 操作だが、SQL に階層を組み込むより読める。
    pub fn folder_counts(&self) -> rusqlite::Result<HashMap<String, i64>> {
        let mut counts: HashMap<String, i64> = HashMap::new();
        let mut statement = self.conn.prepare("SELECT path FROM notes")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        for path in rows {
            let path = path?;
            let folder = match path.rsplit_once('/') {
                Some((head, _)) => head.to_string(),
                None => String::new(),
            };
            *counts.entry(folder).or_insert(0) += 1;
        }
        Ok(counts)
    }

    /// その題名を `[[…]]` で指しているノート（E-6）。
    ///
    /// **大小は無視する**（`COLLATE NOCASE`）。開くときの解決が無視する以上、
    /// 逆から引くときも同じでないと片道になる。日本語には大小が無いので
    /// 効くのは英字だけ。空白のゆれは `wikilink::normalize` が吸収する。
    pub fn backlinks(&self, title: &str) -> rusqlite::Result<Vec<Backlink>> {
        let target = crate::wikilink::normalize(title);
        if target.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT notes.path, notes.title, links.context
             FROM notes JOIN links ON links.path = notes.path
             WHERE links.target = ?1 COLLATE NOCASE",
        )?;
        let rows = statement.query_map([target], |row| {
            Ok(Backlink {
                path: row.get(0)?,
                title: row.get(1)?,
                context: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    /// ノートの題名だけ（`[[` 補完の素材）。
    ///
    /// 一覧（`list_notes`）は preview まで運ぶので、打鍵ごとに呼ぶには重い
    /// （参照実装のコードレビュー指摘）。
    pub fn note_titles(&self) -> rusqlite::Result<Vec<String>> {
        let mut statement = self.conn.prepare("SELECT title FROM notes")?;
        let rows = statement.query_map([], |row| row.get(0))?;
        rows.collect()
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
                "SELECT path, title, snippet(notes_fts, 2, '', '', '…', 12)
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
                 WHERE title LIKE ?1 ESCAPE '\\'
                    OR preview LIKE ?1 ESCAPE '\\'
                    OR path LIKE ?1 ESCAPE '\\'
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
    fn test_list_notes_pinnedがfront_matterから一覧に載る() {
        let (_root, vault) = vault_with(&[
            ("留めた.md", "---\npinned: true\n---\n# 留めた\n"),
            ("普通.md", "# 普通\n"),
        ]);
        let db = synced(&vault);
        let notes = db.list_notes().unwrap();
        let pinned: Vec<(&str, bool)> = notes.iter().map(|n| (n.path.as_str(), n.pinned)).collect();
        assert!(pinned.contains(&("留めた.md", true)));
        assert!(pinned.contains(&("普通.md", false)));
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
    fn test_search_フォルダ名でも見つかる() {
        // 実機で発覚した回帰: 「日記」フォルダのノートが「日記」で出なかった。
        // 題名にもプレビューにも語が無く、パスにだけある場合を保証する
        let (_root, vault) = vault_with(&[
            ("日記/2026-09-02.md", "# 今日の記録\n"),
            ("会議メモ/週次.md", "# 週次\n\n進捗の共有。\n"),
        ]);
        let db = synced(&vault);
        // 2 文字 → LIKE フォールバックがパスに当たる
        assert_eq!(
            paths(&db.search("日記").unwrap()),
            vec!["日記/2026-09-02.md"]
        );
        // 3 文字以上 → trigram FTS がパスに当たる
        assert_eq!(
            paths(&db.search("会議メモ").unwrap()),
            vec!["会議メモ/週次.md"]
        );
    }

    #[test]
    fn test_古いスキーマの索引は捨てて作り直す() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n作り直しの検証。\n")]);
        // 旧世代の索引ファイルを装う: 版数 0 + 互換性の無いテーブル
        let index_path = vault.managed_dir().join(INDEX_FILE);
        {
            let conn = Connection::open(&index_path).unwrap();
            conn.execute_batch("CREATE TABLE notes (old_only TEXT);")
                .unwrap();
        }

        let db = synced(&vault); // 開き直しで作り直されるはず

        assert_eq!(paths(&db.search("作り直しの検証").unwrap()), vec!["a.md"]);
    }

    #[test]
    fn test_list_notes_一覧の素材を返す() {
        let (_root, vault) = vault_with(&[
            ("会議.md", "# 会議\n\n進捗の共有について。\n"),
            ("日記/今日.md", "# 今日\n\n晴れ。\n"),
        ]);
        let db = synced(&vault);
        let mut found = db.list_notes().unwrap();
        found.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].path, "会議.md");
        assert_eq!(found[0].title, "会議");
        assert_eq!(found[0].preview, "進捗の共有について。");
        assert!(found[0].mtime_ms > 1_600_000_000_000); // ms 単位である
        assert_eq!(found[1].path, "日記/今日.md");
    }

    #[test]
    fn test_tag_list_タグと件数を返し_変更と削除に追従する() {
        let (root, vault) = vault_with(&[
            ("a.md", "# a\n\n#work/会議 と #メモ\n"),
            ("b.md", "# b\n\n#メモ だけ\n"),
        ]);
        let mut db = synced(&vault);
        assert_eq!(
            db.tag_list().unwrap(),
            vec![("メモ".to_string(), 2), ("work/会議".to_string(), 1)]
        );

        // タグを消す編集に追従する
        fs::write(root.path().join("b.md"), "# b\n\nタグ無しに変えた\n").unwrap();
        db.sync(&vault).unwrap();
        // 同数のタイはバイト順（ASCII が先）
        assert_eq!(
            db.tag_list().unwrap(),
            vec![("work/会議".to_string(), 1), ("メモ".to_string(), 1)]
        );

        // ノートの削除にも追従する
        fs::remove_file(root.path().join("a.md")).unwrap();
        db.sync(&vault).unwrap();
        assert_eq!(db.tag_list().unwrap(), Vec::<(String, i64)>::new());
    }

    #[test]
    fn test_notes_with_tag_そのタグと配下のタグを持つノートだけ返す() {
        let (_root, vault) = vault_with(&[
            ("a.md", "# a\n\n#work が付いている\n"),
            ("b.md", "# b\n\n#work/会議 は配下\n"),
            ("c.md", "# c\n\n#workshop は別のタグ\n"),
            ("d.md", "# d\n\nタグは無いが work とは書いてある\n"),
        ]);
        let db = synced(&vault);

        let mut found: Vec<String> = db
            .notes_with_tag("work")
            .unwrap()
            .into_iter()
            .map(|note| note.path)
            .collect();
        found.sort();

        assert_eq!(found, vec!["a.md".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn test_notes_with_tag_大文字小文字は正規化して当てる() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n#Work/会議 の記録\n")]);
        let db = synced(&vault);

        let found = db.notes_with_tag("WORK").unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "a.md");
        // 一覧と同じ素材が揃っている（並び順・ピンはフロント側の持ち物）
        assert_eq!(found[0].title, "a");
    }

    #[test]
    fn test_notes_with_tag_知らないタグは空() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n#メモ\n")]);
        let db = synced(&vault);

        assert!(db.notes_with_tag("会議").unwrap().is_empty());
        assert!(db.notes_with_tag("").unwrap().is_empty());
    }

    #[test]
    fn test_backlinks_その題名を指しているノートを返す() {
        let (_root, vault) = vault_with(&[
            ("会議メモ.md", "# 会議メモ\n\n本体。\n"),
            ("日報.md", "# 日報\n\n打ち合わせは [[会議メモ]] を見よ。\n"),
            ("計画.md", "# 計画\n\n[[会議メモ]] と [[日報]]。\n"),
            ("無関係.md", "# 無関係\n\n会議メモ とだけ書いてある。\n"),
        ]);
        let db = synced(&vault);

        let mut found = db.backlinks("会議メモ").unwrap();
        found.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].path, "日報.md");
        // 冒頭ではなく**指している行**を出す（長いノートでは冒頭を見ても
        // 関係が分からない）
        assert_eq!(found[0].context, "打ち合わせは [[会議メモ]] を見よ。");
        assert_eq!(found[1].path, "計画.md");
    }

    #[test]
    fn test_backlinks_大小と空白のゆれを吸収する() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n[[Meeting  Notes]]\n")]);
        let db = synced(&vault);

        assert_eq!(db.backlinks("meeting notes").unwrap().len(), 1);
        assert!(db.backlinks("").unwrap().is_empty());
    }

    #[test]
    fn test_backlinks_リンクを消したら消える() {
        let (root, vault) = vault_with(&[
            ("会議メモ.md", "# 会議メモ\n"),
            ("日報.md", "# 日報\n\n[[会議メモ]]\n"),
        ]);
        let mut db = synced(&vault);
        assert_eq!(db.backlinks("会議メモ").unwrap().len(), 1);

        fs::write(root.path().join("日報.md"), "# 日報\n\nもう指していない\n").unwrap();
        db.sync(&vault).unwrap();

        assert!(db.backlinks("会議メモ").unwrap().is_empty());
    }

    #[test]
    fn test_note_titles_補完の素材を題名だけ返す() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n"), ("仕事/b.md", "# b\n")]);
        let db = synced(&vault);

        let mut found = db.note_titles().unwrap();
        found.sort();

        assert_eq!(found, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn test_notes_in_folder_直下のノートだけ返す() {
        let (_root, vault) = vault_with(&[
            ("直下.md", "# 直下\n"),
            ("仕事/会議.md", "# 会議\n"),
            ("仕事/2026/計画.md", "# 計画\n"),
            ("仕事場/別物.md", "# 別物\n"),
        ]);
        let db = synced(&vault);

        let paths = |folder: &str| {
            let mut found: Vec<String> = db
                .notes_in_folder(folder)
                .unwrap()
                .into_iter()
                .map(|note| note.path)
                .collect();
            found.sort();
            found
        };

        // 子孫は含めない（Finder と同じ読み方）
        assert_eq!(paths("仕事"), vec!["仕事/会議.md".to_string()]);
        // 区切りまで含めて前方一致する（`仕事` で `仕事場/` を拾わない）
        assert_eq!(paths("仕事場"), vec!["仕事場/別物.md".to_string()]);
        // 空文字は直下
        assert_eq!(paths(""), vec!["直下.md".to_string()]);
    }

    #[test]
    fn test_folder_counts_直下だけを数える() {
        let (_root, vault) = vault_with(&[
            ("直下.md", "# 直下\n"),
            ("仕事/会議.md", "# 会議\n"),
            ("仕事/日報.md", "# 日報\n"),
            ("仕事/2026/計画.md", "# 計画\n"),
        ]);
        let db = synced(&vault);

        let counts = db.folder_counts().unwrap();

        // 親が子のぶんまで数えると「2 と出ているのに 1 件しか出ない」になる
        assert_eq!(counts.get(""), Some(&1));
        assert_eq!(counts.get("仕事"), Some(&2));
        assert_eq!(counts.get("仕事/2026"), Some(&1));
    }

    #[test]
    fn test_remove_1ファイルを索引から外す() {
        let (root, vault) = vault_with(&[
            ("a.md", "# a\n\n#タグ 付きの本文。\n"),
            ("b.md", "# b\n\n残る方。\n"),
        ]);
        let mut db = synced(&vault);

        db.remove(&vault, &root.path().join("a.md")).unwrap();

        assert_eq!(db.list_notes().unwrap().len(), 1);
        assert_eq!(db.search("タグ 付きの本文").unwrap(), vec![]);
        assert_eq!(db.tag_list().unwrap(), Vec::<(String, i64)>::new());
    }

    #[test]
    fn test_search_空クエリは何も返さない() {
        let (_root, vault) = vault_with(&[("a.md", "# a\n\n本文。\n")]);
        let db = synced(&vault);
        assert_eq!(db.search("").unwrap(), vec![]);
        assert_eq!(db.search("   ").unwrap(), vec![]);
    }
}
