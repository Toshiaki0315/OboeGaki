// MCP サーバの中核（ADR-0051、TASKS 第 10 群）。バイナリ（bin/mcp.rs）は
// rmcp との橋渡しだけで、答えの中身はここが作る（T3: ヘッドレスに試せる）。
//
// - 索引は**読む**。アプリが動いていれば索引はアプリが育てている。動いて
//   いなければ問い合わせの前に差分同期を自分で走らせる（2 つのプロセスが
//   同時に SQLite へ書かない約束）
// - `.mcp-ignore`（保管フォルダ直下、1 行 1 フォルダ）の中は見せない。
//   `.trash` / `templates` / 管理フォルダは既定で見せない

use std::path::{Path, PathBuf};

use crate::index_db::{IndexDb, NoteMeta, SearchHit};
use crate::vault::{read_note, Vault, SKIP_DIRS};

/// `.mcp-ignore` の置き場（保管フォルダ直下）
pub const IGNORE_FILE: &str = ".mcp-ignore";
/// 1 回の応答で返す本文の上限（文字）。クライアントのコンテキストを食い潰さない
pub const MAX_TEXT_CHARS: usize = 20_000;
pub const TRUNCATED_MARK: &str = "\n…（続きがあります。先頭だけを返しました）";

/// 見せないフォルダの一覧。`.mcp-ignore` の各行（`#` から始まる行と空行は
/// 飛ばす）と、一覧に出ないもの（`.trash` / `templates` / 管理フォルダ）
#[derive(Debug, Clone, Default)]
pub struct IgnoreList {
    folders: Vec<String>,
}

impl IgnoreList {
    pub fn load(root: &Path) -> Self {
        let folders = std::fs::read_to_string(root.join(IGNORE_FILE))
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().trim_matches('/').to_string())
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
        Self { folders }
    }

    /// vault からの相対パスがその中か。**区切りで見る**（`秘密` は `秘密2` を
    /// 隠さない）。既定で見せないフォルダは先頭の成分で見る
    pub fn is_ignored(&self, relative: &str) -> bool {
        let first = relative.split('/').next().unwrap_or("");
        if SKIP_DIRS.contains(&first) || first.starts_with('.') {
            return true;
        }
        self.folders
            .iter()
            .any(|folder| relative == folder || relative.starts_with(&format!("{folder}/")))
    }
}

/// resource の URI の頭（ADR-0051 の `oboegaki://note/<相対パス>`）
pub const NOTE_URI_PREFIX: &str = "oboegaki://note/";

/// 関連するノート 1 件（根拠ごと返す。**なぜ出たかが読めないと確かめようがない**）
#[derive(Debug, Clone, serde::Serialize)]
pub struct RelatedNote {
    pub path: String,
    pub title: String,
    pub reasons: Vec<String>,
    pub score: i32,
}

/// 版 1 つ（一覧では時刻だけ。本文は `history_text` で名指しに引く）
#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoryEntry {
    /// `2026-09-02 10:00:00`。`history_text` にそのまま渡す
    pub stamp: String,
}

/// 資源として並べる 1 件
#[derive(Debug, Clone, serde::Serialize)]
pub struct NoteResource {
    pub uri: String,
    pub path: String,
    pub title: String,
}

/// 相対パスを resource の URI にする。**符号化して渡す** — 空白や `#` を
/// 素で置くと URI として壊れる（日本語は通るが揃えて encode する）
pub fn note_uri(relative: &str) -> String {
    let mut out = String::from(NOTE_URI_PREFIX);
    for byte in relative.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~' | '/') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// URI から相対パスへ戻す。おぼえがきの URI でなければ None。
/// **符号化されていない日本語のまま来ても読む**（そうするクライアントがある）
pub fn path_from_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix(NOTE_URI_PREFIX)?;
    let bytes = rest.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            match u8::from_str_radix(hex, 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                Err(_) => return None,
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/// read_note の答え
#[derive(Debug, Clone, serde::Serialize)]
pub struct NoteText {
    pub path: String,
    pub text: String,
    pub mtime_ms: i64,
    /// 長すぎて先頭だけになったか
    pub truncated: bool,
}

/// MCP から見た保管フォルダ。索引は読むだけ（アプリが動いていなければ、
/// 聞く前に差分同期を自分で走らせる）
pub struct McpVault {
    vault: Vault,
    ignore: IgnoreList,
}

impl McpVault {
    pub fn open(root: &Path) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!("保管フォルダが無い: {}", root.display()));
        }
        let vault = Vault::new(root);
        vault.ensure_layout().map_err(|e| e.to_string())?;
        Ok(Self {
            vault,
            ignore: IgnoreList::load(root),
        })
    }

    pub fn root(&self) -> &Path {
        self.vault.root()
    }

    /// おぼえがき本体がこの保管フォルダを開いているか（二重起動ロックで見る。
    /// 取れたらすぐ手放す）
    pub fn app_running(&self) -> bool {
        matches!(
            crate::vault_lock::acquire(&self.vault.managed_dir()),
            crate::vault_lock::LockOutcome::Busy
        )
    }

    /// 索引を開く。アプリが動いていなければ差分同期してから
    fn index(&self) -> Result<IndexDb, String> {
        let mut db = IndexDb::open(&self.vault.managed_dir()).map_err(|e| e.to_string())?;
        if !self.app_running() {
            db.sync(&self.vault).map_err(|e| e.to_string())?;
        }
        Ok(db)
    }

    fn visible<T>(&self, rows: Vec<T>, path_of: impl Fn(&T) -> &str) -> Vec<T> {
        rows.into_iter()
            .filter(|row| !self.ignore.is_ignored(path_of(row)))
            .collect()
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchHit>, String> {
        let db = self.index()?;
        let hits = db.search(query).map_err(|e| e.to_string())?;
        Ok(self.visible(hits, |hit| hit.path.as_str()))
    }

    /// 一覧。folder は vault からの相対（None で全部、Some("") で直下）、tag は
    /// そのタグ（配下も）を持つもの。両方あれば両方で絞る
    pub fn list_notes(
        &self,
        folder: Option<&str>,
        tag: Option<&str>,
    ) -> Result<Vec<NoteMeta>, String> {
        let db = self.index()?;
        let mut rows = match (folder, tag) {
            (_, Some(tag)) => db.notes_with_tag(tag).map_err(|e| e.to_string())?,
            (Some(folder), None) => db.notes_in_folder(folder).map_err(|e| e.to_string())?,
            (None, None) => db.list_notes().map_err(|e| e.to_string())?,
        };
        if let (Some(folder), Some(_)) = (folder, tag) {
            let cleaned = folder.trim_matches('/');
            rows.retain(|row| {
                let parent = row
                    .path
                    .rsplit_once('/')
                    .map(|(head, _)| head)
                    .unwrap_or("");
                parent == cleaned
            });
        }
        Ok(self.visible(rows, |row| row.path.as_str()))
    }

    pub fn list_folders(&self) -> Result<Vec<(String, i64)>, String> {
        let db = self.index()?;
        let counts = db.folder_counts().map_err(|e| e.to_string())?;
        let mut folders: Vec<(String, i64)> = self
            .vault
            .folders()
            .into_iter()
            .filter(|folder| !self.ignore.is_ignored(folder))
            .map(|folder| {
                let count = counts.get(&folder).copied().unwrap_or(0);
                (folder, count)
            })
            .collect();
        folders.sort();
        Ok(folders)
    }

    pub fn list_tags(&self) -> Result<Vec<(String, i64)>, String> {
        self.index()?.tag_list().map_err(|e| e.to_string())
    }

    /// 相対パスを確かめて（無視の中・保管フォルダの外は断る）整えた形と
    /// 実際の場所を返す。**読みの入口はすべてここを通す**
    fn guarded(&self, relative: &str) -> Result<(String, PathBuf), String> {
        let cleaned = relative.trim_matches('/');
        if cleaned.is_empty() || cleaned.split('/').any(|part| part == "..") {
            return Err("保管フォルダの外は読まない".to_string());
        }
        if self.ignore.is_ignored(cleaned) {
            return Err(format!("見せない場所です: {cleaned}"));
        }
        let absolute: PathBuf = self.vault.root().join(cleaned);
        if !crate::vault::contains(self.vault.root(), &absolute) {
            return Err("保管フォルダの外は読まない".to_string());
        }
        Ok((cleaned.to_string(), absolute))
    }

    /// 本文。無視の中と保管フォルダの外は断る。長ければ先頭だけ
    pub fn read_note(&self, relative: &str) -> Result<NoteText, String> {
        let (cleaned, absolute) = self.guarded(relative)?;
        let cleaned = cleaned.as_str();
        let text = read_note(&absolute).map_err(|e| e.to_string())?;
        let mtime_ms = std::fs::metadata(&absolute)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let truncated = text.chars().count() > MAX_TEXT_CHARS;
        let text = if truncated {
            let head: String = text.chars().take(MAX_TEXT_CHARS).collect();
            format!("{head}{TRUNCATED_MARK}")
        } else {
            text
        };
        Ok(NoteText {
            path: cleaned.to_string(),
            text,
            mtime_ms,
            truncated,
        })
    }

    /// 関係するノート（10-3）。被リンク・指している先・同じタグ・題名の出現を
    /// 束ねて強い順に。**見せない場所は根拠の段で落とす** — 並べたあとで
    /// 落とすと limit がそのぶん減る
    pub fn related_notes(
        &self,
        relative: &str,
        limit: Option<usize>,
    ) -> Result<Vec<RelatedNote>, String> {
        let (cleaned, _) = self.guarded(relative)?;
        let db = self.index()?;
        let title = db
            .titles_for(std::slice::from_ref(&cleaned))
            .map_err(|e| e.to_string())?
            .remove(&cleaned)
            .unwrap_or_default();
        let signals: Vec<crate::related::Signal> = db
            .related_signals(&cleaned, &title)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|signal| !self.ignore.is_ignored(&signal.key))
            .collect();
        let limit = limit.unwrap_or(crate::related::DEFAULT_LIMIT).max(1);
        let ranked = crate::related::rank(&signals, &cleaned, limit);
        let paths: Vec<String> = ranked.iter().map(|r| r.key.clone()).collect();
        let titles = db.titles_for(&paths).map_err(|e| e.to_string())?;
        Ok(ranked
            .into_iter()
            .map(|related| RelatedNote {
                title: titles.get(&related.key).cloned().unwrap_or_default(),
                path: related.key,
                reasons: related.reasons,
                score: related.score,
            })
            .collect())
    }

    /// 版の一覧（新しい順）。**読むだけ** — MCP から版を書き戻す道は作らない
    pub fn note_history(&self, relative: &str) -> Result<Vec<HistoryEntry>, String> {
        let (cleaned, _) = self.guarded(relative)?;
        Ok(self
            .versions(&cleaned)
            .into_iter()
            .map(|version| HistoryEntry {
                stamp: stamp_of(&version),
            })
            .collect())
    }

    /// その版の本文。**時刻で名指す** — 版の場所を受け取ると、vault の中の
    /// 好きなファイルを「版」として覗けてしまう（commands.rs の
    /// version_in_history と同じ構え）
    pub fn history_text(&self, relative: &str, stamp: &str) -> Result<NoteText, String> {
        let (cleaned, _) = self.guarded(relative)?;
        let version = self
            .versions(&cleaned)
            .into_iter()
            .find(|version| stamp_of(version) == stamp)
            .ok_or_else(|| format!("その版はありません: {stamp}"))?;
        let text = read_note(&version.path).map_err(|e| e.to_string())?;
        let (text, truncated) = clip(text);
        Ok(NoteText {
            path: cleaned,
            text,
            mtime_ms: version.saved_at.and_utc().timestamp_millis(),
            truncated,
        })
    }

    /// 資源として並べるノート（一覧に出るものだけ）
    pub fn list_resources(&self) -> Result<Vec<NoteResource>, String> {
        Ok(self
            .list_notes(None, None)?
            .into_iter()
            .map(|note| NoteResource {
                uri: note_uri(&note.path),
                path: note.path,
                title: note.title,
            })
            .collect())
    }

    fn versions(&self, cleaned: &str) -> Vec<crate::history::Version> {
        let store = crate::history::store_root(&self.vault.managed_dir());
        crate::history::versions(&store, &format!("path:{cleaned}"))
    }
}

/// 一覧と引き当てで同じ形を使う（食い違うと「一覧に出た版が引けない」）
fn stamp_of(version: &crate::history::Version) -> String {
    version.saved_at.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 長い本文は先頭だけにして印を付ける
fn clip(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return (text, false);
    }
    let head: String = text.chars().take(MAX_TEXT_CHARS).collect();
    (format!("{head}{TRUNCATED_MARK}"), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn note(root: &std::path::Path, name: &str, text: &str) {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn test_ignore_list_行ごとのフォルダ_コメントと空行_区切りで見る() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join(".mcp-ignore"),
            "# 見せない\n秘密\n\n仕事/私用\n",
        )
        .unwrap();
        let ignore = IgnoreList::load(root.path());
        assert!(ignore.is_ignored("秘密/a.md"));
        assert!(ignore.is_ignored("仕事/私用/b.md"));
        assert!(!ignore.is_ignored("秘密2/a.md")); // 前方一致ではない
        assert!(!ignore.is_ignored("仕事/a.md"));
        // 既定で見せないもの
        assert!(ignore.is_ignored(".trash/a.md"));
        assert!(ignore.is_ignored("templates/雛形.md"));
        // 無ければ既定だけ
        let none = IgnoreList::load(TempDir::new().unwrap().path());
        assert!(!none.is_ignored("秘密/a.md"));
    }

    #[test]
    fn test_mcp_vault_索引を読み_無視の中は出さない_開いていなければ自分で同期する() {
        let root = TempDir::new().unwrap();
        let vault = crate::vault::Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(
            root.path(),
            "会議メモ.md",
            "# 会議メモ\n\n決めたこと #会議\n",
        );
        note(root.path(), "仕事/予定.md", "# 予定\n\n来週の会議\n");
        note(root.path(), "秘密/給与.md", "# 給与\n\n会議では言わない\n");
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();

        let mcp = McpVault::open(root.path()).unwrap();
        assert!(!mcp.app_running());
        // アプリが動いていないので、聞く前に索引が育つ
        let hits = mcp.search("会議").unwrap();
        let paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        assert!(paths.contains(&"会議メモ.md"));
        assert!(paths.contains(&"仕事/予定.md"));
        assert!(!paths.iter().any(|p| p.starts_with("秘密/")));

        let listed = mcp.list_notes(None, None).unwrap();
        assert!(listed.iter().all(|n| !n.path.starts_with("秘密/")));
        assert_eq!(mcp.list_notes(Some("仕事"), None).unwrap().len(), 1);
        assert_eq!(mcp.list_notes(None, Some("会議")).unwrap().len(), 1);
        assert!(mcp.list_folders().unwrap().iter().all(|(f, _)| f != "秘密"));
        assert!(mcp.list_tags().unwrap().iter().any(|(t, _)| t == "会議"));

        let read = mcp.read_note("会議メモ.md").unwrap();
        assert!(read.text.contains("決めたこと"));
        assert!(read.mtime_ms > 0);
        assert!(mcp.read_note("秘密/給与.md").is_err());
        assert!(mcp.read_note("../外.md").is_err());
    }

    #[test]
    fn test_related_notes_指している_同じタグ_題名の出現を根拠ごと返す() {
        let root = TempDir::new().unwrap();
        let vault = crate::vault::Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(
            root.path(),
            "設計.md",
            "# 設計\n\n[[議事録]] を見る #仕事\n",
        );
        note(root.path(), "議事録.md", "# 議事録\n\n決めたこと #仕事\n");
        note(root.path(), "日報.md", "# 日報\n\n設計 を進めた\n");
        note(root.path(), "秘密/裏.md", "# 裏\n\n[[設計]] の裏 #仕事\n");
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();

        let mcp = McpVault::open(root.path()).unwrap();
        let related = mcp.related_notes("設計.md", None).unwrap();
        let paths: Vec<&str> = related.iter().map(|r| r.path.as_str()).collect();
        assert!(paths.contains(&"議事録.md"));
        assert!(paths.contains(&"日報.md"));
        // 自分は出さない・見せない場所は出さない
        assert!(!paths.contains(&"設計.md"));
        assert!(!paths.iter().any(|p| p.starts_with("秘密/")));
        // 根拠が読める形で付く（題名も引けている）
        let first = related.iter().find(|r| r.path == "議事録.md").unwrap();
        assert_eq!(first.title, "議事録");
        assert!(!first.reasons.is_empty());
        assert!(first.score > 0);
        // 指していて同じタグの方が、題名が出てくるだけより強い
        assert_eq!(related[0].path, "議事録.md");
        assert!(mcp.related_notes("秘密/裏.md", None).is_err());
    }

    #[test]
    fn test_note_history_版の一覧と本文_読むだけ() {
        use chrono::NaiveDate;
        let root = TempDir::new().unwrap();
        let vault = crate::vault::Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "設計.md", "# 設計\n\n今の本文\n");
        let store = crate::history::store_root(&vault.managed_dir());
        let at = |d: u32| {
            NaiveDate::from_ymd_opt(2026, 9, d)
                .unwrap()
                .and_hms_opt(10, 0, 0)
                .unwrap()
        };
        crate::history::keep(&store, "path:設計.md", "古い本文", at(1), true, 0).unwrap();
        crate::history::keep(&store, "path:設計.md", "新しい本文", at(2), true, 0).unwrap();

        let mcp = McpVault::open(root.path()).unwrap();
        let versions = mcp.note_history("設計.md").unwrap();
        assert_eq!(versions.len(), 2);
        // 新しい順
        assert_eq!(versions[0].stamp, "2026-09-02 10:00:00");
        // 本文はその版を名指しで引く
        let text = mcp.history_text("設計.md", &versions[1].stamp).unwrap();
        assert_eq!(text.text, "古い本文");
        assert!(mcp.history_text("設計.md", "2000-01-01 00:00:00").is_err());
        // 見せない場所は断る
        assert!(
            mcp.note_history("秘密/裏.md").is_err()
                || mcp.note_history("秘密/裏.md").unwrap().is_empty()
        );
    }

    #[test]
    fn test_note_uri_日本語や空白を往復できる() {
        assert_eq!(
            note_uri("仕事/会 議.md"),
            "oboegaki://note/%E4%BB%95%E4%BA%8B/%E4%BC%9A%20%E8%AD%B0.md"
        );
        assert_eq!(
            path_from_uri("oboegaki://note/%E4%BB%95%E4%BA%8B/%E4%BC%9A%20%E8%AD%B0.md").unwrap(),
            "仕事/会 議.md"
        );
        // 素の日本語で来ても読む（クライアントが符号化しないことがある）
        assert_eq!(
            path_from_uri("oboegaki://note/仕事/会議.md").unwrap(),
            "仕事/会議.md"
        );
        assert!(path_from_uri("file:///etc/passwd").is_none());
    }

    #[test]
    fn test_list_resources_一覧に出るノートだけを資源として並べる() {
        let root = TempDir::new().unwrap();
        let vault = crate::vault::Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "会議.md", "# 会議\n\n本文\n");
        note(root.path(), "秘密/裏.md", "# 裏\n\n本文\n");
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();
        let mcp = McpVault::open(root.path()).unwrap();
        let resources = mcp.list_resources().unwrap();
        assert!(resources
            .iter()
            .any(|r| r.uri == note_uri("会議.md") && r.title == "会議"));
        assert!(!resources.iter().any(|r| r.path.starts_with("秘密/")));
    }

    #[test]
    fn test_read_note_長い本文は先頭だけにして続きがある印() {
        let root = TempDir::new().unwrap();
        let vault = crate::vault::Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let long: String = (0..5000).map(|i| format!("行 {i}\n")).collect();
        note(root.path(), "長い.md", &long);
        let mcp = McpVault::open(root.path()).unwrap();
        let read = mcp.read_note("長い.md").unwrap();
        assert!(read.text.chars().count() <= MAX_TEXT_CHARS + 100);
        assert!(read.truncated);
        assert!(read.text.ends_with(TRUNCATED_MARK));
    }
}
