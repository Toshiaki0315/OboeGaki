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

    /// 本文。無視の中と保管フォルダの外は断る。長ければ先頭だけ
    pub fn read_note(&self, relative: &str) -> Result<NoteText, String> {
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
