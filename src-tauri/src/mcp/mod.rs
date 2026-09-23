//
// 20-4: 無視リスト（ignore）・URI と設定断片（uri）・節の終わり（section）を
// 横に出した。外から見える名前は `pub use` で変えない

mod ignore;
mod section;
mod uri;

pub use ignore::*;
pub use section::*;
pub use uri::*;

use crate::index_db::{IndexDb, NoteMeta, SearchHit};
use crate::vault::{read_note, Vault};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 1 回の応答で返す本文の上限（文字）。クライアントのコンテキストを食い潰さない
pub const MAX_TEXT_CHARS: usize = 20_000;

pub const TRUNCATED_MARK: &str = "\n…（続きがあります。先頭だけを返しました）";

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

/// 書いた先（10-4）。**書くのは `.md` だけ** — 索引は触らない
#[derive(Debug, Clone, serde::Serialize)]
pub struct Written {
    pub path: String,
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
    /// 書き込みの順番待ち。rmcp は要求ごとにタスクを立てるので、同じノート
    /// への read-modify-write が並ぶと後勝ちで片方が消える（レビュー 2026-09-14）。
    /// 保管フォルダ全体で 1 つ — 書きは稀で短いので、ノート単位に分ける価値はない
    writes: Mutex<()>,
}

impl McpVault {
    pub fn open(root: &Path) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!("保管フォルダが無い: {}", root.display()));
        }
        // **おぼえがきで一度開いた場所だけ**を保管フォルダとみなす。設定 JSON
        // の args を書き間違えて ~/Documents などを渡されたとき、そこに管理
        // フォルダを生やして配下の .md を全部索引に取り込んではいけない
        // （レビュー 2026-09-14）。旧 .hitofude だけの場所は本物なので通す
        let looks_like_vault = root.join(crate::vault::MANAGED_DIR).is_dir()
            || root.join(crate::vault::LEGACY_MANAGED_DIR).is_dir();
        if !looks_like_vault {
            return Err(format!(
                "おぼえがきで開いたことのない場所です（{} が無い）: {}。先にアプリで一度開いてください",
                crate::vault::MANAGED_DIR,
                root.display()
            ));
        }
        let vault = Vault::new(root);
        vault.ensure_layout().map_err(|e| e.to_string())?;
        // 「何を渡さないか」を書く場所は、最初から在った方が気付ける（中身は説明
        // だけで、何も隠さない）。vault 本体は MCP を知らない（19-2 で層の逆転を解いた）
        ensure_ignore_file(vault.root()).map_err(|e| e.to_string())?;
        Ok(Self {
            vault,
            writes: Mutex::new(()),
        })
    }

    /// 書きの入口で握る。毒されていても（別のタスクが panic した）書きは進める
    fn write_turn(&self) -> std::sync::MutexGuard<'_, ()> {
        self.writes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 見せない場所の一覧は**呼ばれるたびに読む**。Claude Desktop はこの
    /// サーバを常駐させるので、起動時の控えを持つと GUI の「渡さない」が
    /// 開き直すまで効かない（レビュー 2026-09-14）。1 つの小さな文字ファイル
    /// なので、毎回読んでも索引を開くより安い
    fn ignore(&self) -> IgnoreList {
        IgnoreList::load(self.vault.root())
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
        let ignore = self.ignore();
        rows.into_iter()
            .filter(|row| !ignore.is_ignored(path_of(row)))
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
        let rows = crate::note_service::list_notes(&db, folder, tag).map_err(|e| e.to_string())?;
        Ok(self.visible(rows, |row| row.path.as_str()))
    }

    pub fn list_folders(&self) -> Result<Vec<(String, i64)>, String> {
        let db = self.index()?;
        let ignore = self.ignore();
        // 件数は**見えるノートだけ**数える（索引の集計はファイル単位で隠した
        // ノートも含む）。直下（空文字）は資源として並べないので落とす
        let mut folders: Vec<(String, i64)> =
            crate::note_service::folders_with_counts(&self.vault, &db, |path| {
                !ignore.is_ignored(path)
            })
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|(folder, _)| !folder.is_empty())
            .collect();
        folders.sort();
        Ok(folders)
    }

    /// タグの一覧。**見せない場所のノートは数えない** — 索引の集計を素通し
    /// すると、隠したノートにしか無いタグがその存在ごと漏れる
    pub fn list_tags(&self) -> Result<Vec<(String, i64)>, String> {
        let db = self.index()?;
        let ignore = self.ignore();
        crate::note_service::tags_with_counts(&db, |path| !ignore.is_ignored(path))
            .map_err(|e| e.to_string())
    }

    /// 相対パスを確かめて（無視の中・保管フォルダの外は断る）整えた形と
    /// 実際の場所を返す。**読みの入口はすべてここを通す**
    fn guarded(&self, relative: &str) -> Result<(String, PathBuf), String> {
        let cleaned = relative.trim_matches('/');
        if cleaned.is_empty() || cleaned.split('/').any(|part| part == "..") {
            return Err("保管フォルダの外は読まない".to_string());
        }
        if self.ignore().is_ignored(cleaned) {
            return Err(format!("見せない場所です: {cleaned}"));
        }
        let absolute: PathBuf = self.vault.root().join(cleaned);
        // 読み書きするのは**ノート（.md）だけ**。設定や添付をこの道で覗かせない
        if !crate::vault::is_markdown(&absolute) {
            return Err(format!("ノートではありません: {cleaned}"));
        }
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
        let (text, truncated) = clip(text);
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
        let ignore = self.ignore();
        let limit = limit.unwrap_or(crate::related::DEFAULT_LIMIT).max(1);
        let ranked = db
            .related_notes(&cleaned, &title, limit, |key| !ignore.is_ignored(key))
            .map_err(|e| e.to_string())?;
        Ok(ranked
            .into_iter()
            .map(|(related, found_title)| RelatedNote {
                title: found_title.unwrap_or_default(),
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
                stamp: version.stamp(),
            })
            .collect())
    }

    /// その版の本文。**時刻で名指す** — 版の場所を受け取ると、vault の中の
    /// 好きなファイルを「版」として覗けてしまう（commands/ の
    /// version_in_history と同じ構え）
    pub fn history_text(&self, relative: &str, stamp: &str) -> Result<NoteText, String> {
        let (cleaned, _) = self.guarded(relative)?;
        let version =
            crate::note_service::version_at(&self.vault, &self.vault.root().join(&cleaned), stamp)
                .ok_or_else(|| format!("その版はありません: {stamp}"))?;
        let text = read_note(&version.path).map_err(|e| e.to_string())?;
        let (text, truncated) = clip(text);
        Ok(NoteText {
            path: cleaned,
            text,
            // `saved_at` はローカルの naive 時刻（`Local::now().naive_local()`
            // 由来）。UTC と読むと時差ぶんずれる
            mtime_ms: chrono::TimeZone::from_local_datetime(&chrono::Local, &version.saved_at)
                .earliest()
                .map(|t| t.timestamp_millis())
                .unwrap_or(0),
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

    /// 新しいノートを作る（10-4）。**書くのは `.md` だけ** — アプリが動いて
    /// いれば FSEvents が拾い、外部変更の流れ（spec §7.5）がそのまま働く
    pub fn create_note(
        &self,
        title: &str,
        text: Option<&str>,
        folder: Option<&str>,
        template: Option<&str>,
    ) -> Result<Written, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("題名が空".to_string());
        }
        let folder = self.guarded_folder(folder)?;
        let body = match template {
            Some(name) => self
                .vault
                .template_text(name, title, &chrono::Local::now())
                .map_err(|e| format!("雛形を読めない: {e}"))?,
            // 題名は本文の見出し（ADR-0005）。本文に見出しが無ければこちらで置く
            None => {
                let body = text.unwrap_or("");
                // front matter があればその**下**に置く（上に差し込むと壊れる）
                let (front, rest) = crate::front_matter::split(body);
                if rest.trim_start().starts_with("# ") {
                    body.to_string()
                } else {
                    format!("{front}# {title}\n\n{}", rest.trim_start_matches('\n'))
                }
            }
        };
        let mut body = body;
        crate::vault::ensure_trailing_newline(&mut body);
        let path = self
            .vault
            .create_in_with(&folder, title, &body)
            .map_err(|e| e.to_string())?;
        Ok(Written {
            path: self.relative_of(&path),
        })
    }

    /// 末尾に足す。見出しを渡せばその節の末尾（次の見出しの手前）へ。
    /// **前の行に繋げない**（末尾に改行が無ければ挟む）
    pub fn append_to_note(
        &self,
        relative: &str,
        text: &str,
        heading: Option<&str>,
    ) -> Result<Written, String> {
        let (cleaned, absolute) = self.guarded(relative)?;
        if text.trim().is_empty() {
            return Err("書くものが空".to_string());
        }
        if !absolute.is_file() {
            return Err(format!("ノートがありません: {cleaned}"));
        }
        let _turn = self.write_turn();
        let current = read_note(&absolute).map_err(|e| e.to_string())?;
        let added = text.trim_end_matches('\n');
        let updated = match heading {
            Some(heading) => {
                let end = section_end(&current, heading)
                    .ok_or_else(|| format!("その見出しはありません: {heading}"))?;
                let (head, tail) = current.split_at(end);
                let mut out = head.trim_end_matches('\n').to_string();
                out.push('\n');
                out.push_str(added);
                out.push('\n');
                if !tail.trim().is_empty() {
                    // 節の切れ目に空行を 1 つ残す（見出しが本文にくっつかない）
                    out.push('\n');
                    out.push_str(tail.trim_start_matches('\n'));
                }
                out
            }
            None => {
                let mut out = current;
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str(added);
                out.push('\n');
                out
            }
        };
        crate::autosave::save_atomic(&absolute, &updated).map_err(|e| e.to_string())?;
        Ok(Written { path: cleaned })
    }

    /// 今日のノート。text があれば末尾に足す。**何度呼んでも同じノート**
    pub fn daily_note(&self, text: Option<&str>) -> Result<Written, String> {
        let now = chrono::Local::now();
        // 書く前に門を通す。今日のノートを名指しで隠していれば、作りも
        // 追記もしない（他の書き口と同じ規則。レビュー 2026-09-14）
        self.guarded(&self.relative_of(&self.vault.daily_path(&now)))?;
        let _turn = self.write_turn();
        let path = match text {
            Some(text) if !text.trim().is_empty() => self
                .vault
                .append_to_daily(&now, text)
                .map_err(|e| e.to_string())?,
            _ => self.vault.daily_note(&now).map_err(|e| e.to_string())?.path,
        };
        Ok(Written {
            path: self.relative_of(&path),
        })
    }

    /// 本文を丸ごと差し替える（10-5）。**楽観ロック** — `read_note` で得た
    /// 更新時刻を添えさせ、違えば断る（AI が古い本文を元に上書きしない）
    pub fn replace_note(
        &self,
        relative: &str,
        text: &str,
        expected_mtime_ms: i64,
    ) -> Result<Written, String> {
        let (cleaned, absolute) = self.guarded(relative)?;
        if !absolute.is_file() {
            return Err(format!("ノートがありません: {cleaned}"));
        }
        let _turn = self.write_turn();
        let current = self.read_note(&cleaned)?;
        if current.mtime_ms != expected_mtime_ms {
            return Err(format!(
                "ノートが変わっています（read_note で読み直してから書いてください）: {cleaned}"
            ));
        }
        // **差し替える前の姿は必ず残す**（ADR-0023 / T7）。アプリが動いていても
        // 頼らない — watcher は外部変更で版を残さないので、開いていないノート
        // を差し替えると旧本文がどこにも無くなる（レビュー 2026-09-14）。
        // 直前の版と同じ中身なら `keep` が黙って飛ばすので二重にはならない。
        // **残せなかったら差し替えない** — 以前は eprintln だけで書き進めて
        // いた。AI には isError で返り、人に見える（レビュー 2026-09-23）
        {
            let whole = read_note(&absolute).map_err(|e| e.to_string())?;
            let store = crate::history::store_root(&self.vault.managed_dir());
            crate::history::keep(
                &store,
                &self.vault.history_key(&absolute),
                &whole,
                chrono::Local::now().naive_local(),
                true,
                0,
            )
            .map_err(|error| {
                format!(
                    "差し替える前の版を残せなかったので、書きませんでした: {cleaned}（{error}）"
                )
            })?;
        }
        let mut text = text.to_string();
        crate::vault::ensure_trailing_newline(&mut text);
        crate::autosave::save_atomic(&absolute, &text).map_err(|e| e.to_string())?;
        Ok(Written { path: cleaned })
    }

    /// 別のフォルダへ移す。履歴の鍵も付いて回る（ADR-0042。vault が持つ）
    pub fn move_note(&self, relative: &str, folder: &str) -> Result<Written, String> {
        let (_, absolute) = self.guarded(relative)?;
        let destination = self.guarded_folder(Some(folder))?;
        let moved = self
            .vault
            .move_note(&absolute, &destination)
            .map_err(|e| e.to_string())?;
        Ok(Written {
            path: self.relative_of(&moved),
        })
    }

    /// ゴミ箱へ移す。**消すのはここまで** — 空にする道は作らない。
    /// 削除ガード（ピン留め）と履歴の引っ越しは vault が持つ（画面からの
    /// 「ゴミ箱へ移動」と同じ道を通す）
    pub fn trash_note(&self, relative: &str) -> Result<Written, String> {
        let (cleaned, absolute) = self.guarded(relative)?;
        if !absolute.is_file() {
            return Err(format!("ノートがありません: {cleaned}"));
        }
        let moved = self
            .vault
            .trash_note(&absolute)
            .map_err(|e| e.to_string())?;
        Ok(Written {
            path: self.relative_of(&moved),
        })
    }

    /// 書く先のフォルダを確かめる（空は直下）。実在は `create_in_with` が見る
    fn guarded_folder(&self, folder: Option<&str>) -> Result<String, String> {
        let cleaned = folder.unwrap_or("").trim_matches('/');
        if cleaned.is_empty() {
            return Ok(String::new());
        }
        if cleaned.split('/').any(|part| part == "..") {
            return Err("保管フォルダの外には作れない".to_string());
        }
        if self.ignore().is_ignored(cleaned) {
            return Err(format!("見せない場所です: {cleaned}"));
        }
        Ok(cleaned.to_string())
    }

    fn relative_of(&self, path: &std::path::Path) -> String {
        path.strip_prefix(self.vault.root())
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned()
    }

    fn versions(&self, cleaned: &str) -> Vec<crate::history::Version> {
        crate::note_service::versions(&self.vault, &self.vault.root().join(cleaned))
    }
}

/// 一覧と引き当てで同じ形を使う（食い違うと「一覧に出た版が引けない」）
/// 長い本文は先頭だけにして印を付ける
fn clip(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return (text, false);
    }
    let head: String = text.chars().take(MAX_TEXT_CHARS).collect();
    (format!("{head}{TRUNCATED_MARK}"), true)
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::mcp::ignore::set_hidden;
    use crate::mcp::ignore::IGNORE_FILE;
    use crate::test_support::{note, temp_vault};
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_mcp_vault_索引を読み_無視の中は出さない_開いていなければ自分で同期する() {
        let (root, _vault) = temp_vault();
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
        let (root, _vault) = temp_vault();
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
        let (root, vault) = temp_vault();
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
        assert!(mcp.note_history("秘密/裏.md").is_err());
    }

    #[test]
    fn test_list_resources_一覧に出るノートだけを資源として並べる() {
        let (root, _vault) = temp_vault();
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
    fn test_create_note_フォルダと雛形で作る_見せない場所には作らない() {
        let (root, vault) = temp_vault();
        fs::create_dir_all(root.path().join("仕事")).unwrap();
        fs::write(
            vault.templates_dir().join("議事録.md"),
            "---\npinned: true\n---\n# {{title}}\n\n## 決めたこと\n",
        )
        .unwrap();
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();
        fs::create_dir_all(root.path().join("秘密")).unwrap();
        let mcp = McpVault::open(root.path()).unwrap();

        let made = mcp
            .create_note("覚え書き", Some("本文\n"), Some("仕事"), None)
            .unwrap();
        assert_eq!(made.path, "仕事/覚え書き.md");
        let text = mcp.read_note(&made.path).unwrap().text;
        assert!(text.starts_with("# 覚え書き\n"));
        assert!(text.contains("本文"));

        // 雛形から（front matter は持ち込まない。`{{title}}` は埋まる）
        let from = mcp
            .create_note("9 月定例", None, Some("仕事"), Some("議事録"))
            .unwrap();
        let text = mcp.read_note(&from.path).unwrap().text;
        assert!(text.starts_with("# 9 月定例\n"));
        assert!(text.contains("## 決めたこと"));
        assert!(!text.contains("pinned"));

        // 見せない場所・保管フォルダの外・知らない雛形は断る
        assert!(mcp.create_note("裏", None, Some("秘密"), None).is_err());
        assert!(mcp.create_note("外", None, Some("../外"), None).is_err());
        assert!(mcp
            .create_note("無い雛形", None, None, Some("無い"))
            .is_err());
        assert!(mcp.create_note("  ", None, None, None).is_err());
    }

    #[test]
    fn test_append_to_note_末尾と節の末尾に足す_前の行に繋げない() {
        let (root, _vault) = temp_vault();
        note(
            root.path(),
            "設計.md",
            "# 設計\n\n## 決めたこと\n\n- A\n\n## 宿題\n\n- B",
        );
        let mcp = McpVault::open(root.path()).unwrap();

        // 節を指定: その節の末尾（次の見出しの手前）へ
        mcp.append_to_note("設計.md", "- C", Some("決めたこと"))
            .unwrap();
        let text = mcp.read_note("設計.md").unwrap().text;
        assert!(text.contains("- A\n- C\n\n## 宿題"), "{text:?}");

        // 節を指定しない: 文書の末尾（改行が無くても前の行に繋げない）
        mcp.append_to_note("設計.md", "- D", None).unwrap();
        let text = mcp.read_note("設計.md").unwrap().text;
        assert!(text.ends_with("- B\n- D\n"), "{text:?}");

        assert!(mcp.append_to_note("設計.md", "  ", None).is_err());
        assert!(mcp
            .append_to_note("設計.md", "x", Some("無い見出し"))
            .is_err());
        assert!(mcp.append_to_note("秘密/裏.md", "x", None).is_err());
        assert!(mcp.append_to_note("無い.md", "x", None).is_err());
    }

    #[test]
    fn test_mcp_ignore_を書き換えたら_開き直さなくても次の呼び出しから効く() {
        // Claude Desktop は MCP サーバを常駐させる。GUI で「渡さない」に
        // した瞬間から効かないと、画面の印と実態が食い違う（レビュー 2026-09-14）
        let (root, _vault) = temp_vault();
        note(root.path(), "秘密/給与.md", "# 給与\n\n会議では言わない\n");
        let mcp = McpVault::open(root.path()).unwrap();
        assert!(mcp.read_note("秘密/給与.md").is_ok());

        set_hidden(root.path(), "秘密", true).unwrap();
        assert!(mcp.read_note("秘密/給与.md").is_err());
        assert!(mcp.search("会議").unwrap().is_empty());
        assert!(mcp.list_notes(None, None).unwrap().is_empty());

        set_hidden(root.path(), "秘密", false).unwrap();
        assert!(mcp.read_note("秘密/給与.md").is_ok());
    }

    #[test]
    fn test_list_tags_見せない場所のノートは数えない() {
        let (root, _vault) = temp_vault();
        note(
            root.path(),
            "会議メモ.md",
            "# 会議メモ\n\n決めたこと #会議\n",
        );
        note(
            root.path(),
            "秘密/給与.md",
            "# 給与\n\n#会議 で言わない #転職活動\n",
        );
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();
        let mcp = McpVault::open(root.path()).unwrap();

        let tags = mcp.list_tags().unwrap();
        // 隠したノートにしか無いタグは、存在そのものを漏らさない
        assert!(!tags.iter().any(|(tag, _)| tag == "転職活動"));
        // 両方にあるタグは、見えるノートのぶんだけ数える
        assert_eq!(
            tags.iter().find(|(tag, _)| tag == "会議").map(|(_, n)| *n),
            Some(1)
        );
    }

    #[test]
    fn test_daily_note_今日のノートが見せない場所なら_作らず追記もしない() {
        let (root, _vault) = temp_vault();
        let mcp = McpVault::open(root.path()).unwrap();
        let today = mcp.daily_note(None).unwrap();
        let before = read_note(&root.path().join(&today.path)).unwrap();

        set_hidden(root.path(), &today.path, true).unwrap();
        assert!(mcp.daily_note(Some("こっそり")).is_err());
        assert!(mcp.daily_note(None).is_err());
        // 断ったなら中身も変わっていない
        assert_eq!(read_note(&root.path().join(&today.path)).unwrap(), before);
    }

    #[test]
    fn test_daily_note_今日のノートを返し_文があれば末尾に足す() {
        let (root, _vault) = temp_vault();
        let mcp = McpVault::open(root.path()).unwrap();

        let first = mcp.daily_note(None).unwrap();
        assert!(first.path.ends_with(".md"));
        // 何度呼んでも同じノート（2 つできると、どちらに書いたか分からない）
        let again = mcp.daily_note(Some("思いついたこと")).unwrap();
        assert_eq!(again.path, first.path);
        assert!(mcp
            .read_note(&first.path)
            .unwrap()
            .text
            .contains("思いついたこと"));
    }

    #[test]
    fn test_replace_note_更新時刻が合わなければ断る_版を残してから差し替える() {
        let (root, _vault) = temp_vault();
        note(root.path(), "設計.md", "# 設計\n\n古い本文\n");
        let mcp = McpVault::open(root.path()).unwrap();
        let before = mcp.read_note("設計.md").unwrap();

        // 古い時刻を持ったまま書くと断られる（AI が古い本文で上書きしない）
        assert!(mcp
            .replace_note("設計.md", "# 設計\n\n新しい\n", before.mtime_ms - 1000)
            .is_err());
        assert!(mcp.read_note("設計.md").unwrap().text.contains("古い本文"));

        mcp.replace_note("設計.md", "# 設計\n\n新しい本文\n", before.mtime_ms)
            .unwrap();
        assert!(mcp
            .read_note("設計.md")
            .unwrap()
            .text
            .contains("新しい本文"));

        // アプリが動いていないので、MCP 側が差し替える前の姿を版に残す
        let versions = mcp.note_history("設計.md").unwrap();
        assert_eq!(versions.len(), 1);
        let kept = mcp.history_text("設計.md", &versions[0].stamp).unwrap();
        assert!(kept.text.contains("古い本文"));

        assert!(mcp.replace_note("無い.md", "x", 0).is_err());
        assert!(mcp.replace_note("秘密/裏.md", "x", 0).is_err());
    }

    #[test]
    fn test_replace_note_アプリが動いていても_差し替え前の版を残す() {
        // 「アプリが動いていればアプリの保存が残す」は成り立たない —
        // watcher は外部変更で版を残さないので、開いていないノートを差し替え
        // ると旧本文が消える（レビュー 2026-09-14。ADR-0023 / T7）
        let (root, vault) = temp_vault();
        note(root.path(), "設計.md", "# 設計\n\n古い本文\n");
        let mcp = McpVault::open(root.path()).unwrap();
        let _app = crate::vault_lock::acquire(&vault.managed_dir());
        assert!(mcp.app_running());

        let before = mcp.read_note("設計.md").unwrap();
        mcp.replace_note("設計.md", "# 設計\n\n新しい本文\n", before.mtime_ms)
            .unwrap();
        let versions = mcp.note_history("設計.md").unwrap();
        assert_eq!(versions.len(), 1);
        let kept = mcp.history_text("設計.md", &versions[0].stamp).unwrap();
        assert!(kept.text.contains("古い本文"));
    }

    #[test]
    fn test_replace_note_版を残せなければ差し替えず_断る() {
        // 版を残せないまま差し替えると旧本文がどこにも無くなる。AI には
        // isError で返して、人に見える形で止める（レビュー 2026-09-23）
        let (root, vault) = temp_vault();
        note(root.path(), "設計.md", "# 設計\n\n古い本文\n");
        let mcp = McpVault::open(root.path()).unwrap();
        let before = mcp.read_note("設計.md").unwrap();
        let _locked = crate::test_support::lock_history(&vault);

        let result = mcp.replace_note("設計.md", "# 設計\n\n新しい本文\n", before.mtime_ms);
        assert!(result.is_err());
        assert!(mcp.read_note("設計.md").unwrap().text.contains("古い本文"));
    }

    #[test]
    fn test_open_おぼえがきで開いたことのない場所には_足場を作らない() {
        // 設定 JSON の args を書き間違えて ~/Documents などを渡しても、そこに
        // 管理フォルダを生やして索引に全部取り込んではいけない（レビュー 2026-09-14）
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("書類.md"), "# 書類\n").unwrap();
        assert!(McpVault::open(root.path()).is_err());
        assert!(!root.path().join(crate::vault::MANAGED_DIR).exists());
        assert!(!root.path().join(IGNORE_FILE).exists());

        // 旧 .hitofude だけの保管フォルダは本物なので開ける（改名して引き継ぐ = T7）
        fs::create_dir_all(root.path().join(crate::vault::LEGACY_MANAGED_DIR)).unwrap();
        assert!(McpVault::open(root.path()).is_ok());
        assert!(root.path().join(crate::vault::MANAGED_DIR).is_dir());
    }

    #[test]
    fn test_history_text_mtime_msはローカル時刻として読む() {
        use chrono::{NaiveDate, TimeZone};
        let (root, vault) = temp_vault();
        note(root.path(), "設計.md", "# 設計\n");
        let store = crate::history::store_root(&vault.managed_dir());
        let at = NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:設計.md", "古い", at, true, 0).unwrap();
        let mcp = McpVault::open(root.path()).unwrap();
        let versions = mcp.note_history("設計.md").unwrap();
        let text = mcp.history_text("設計.md", &versions[0].stamp).unwrap();
        // 版の時刻は `Local::now().naive_local()` 由来 = ローカル。UTC と読むと
        // JST で 9 時間ずれる（レビュー 2026-09-14）
        let want = chrono::Local
            .from_local_datetime(&at)
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!(text.mtime_ms, want);
    }

    #[test]
    fn test_append_to_note_同時に足しても片方が消えない() {
        // rmcp は要求ごとにタスクを立てるので、同じノートへの追記が並ぶ。
        // read-modify-write に排他が無いと後勝ちで片方が消える（レビュー 2026-09-14）
        let (root, _vault) = temp_vault();
        note(root.path(), "日誌.md", "# 日誌\n");
        let mcp = McpVault::open(root.path()).unwrap();
        let rounds = 40;
        std::thread::scope(|scope| {
            for who in ["A", "B"] {
                let mcp = &mcp;
                scope.spawn(move || {
                    for i in 0..rounds {
                        mcp.append_to_note("日誌.md", &format!("{who}{i}"), None)
                            .unwrap();
                    }
                });
            }
        });
        let text = mcp.read_note("日誌.md").unwrap().text;
        for who in ["A", "B"] {
            for i in 0..rounds {
                assert!(text.contains(&format!("{who}{i}\n")), "消えた: {who}{i}");
            }
        }
    }

    #[test]
    fn test_read_note_mdでないものは読まない() {
        let (root, _vault) = temp_vault();
        fs::write(root.path().join("メモ.txt"), "秘密の設定\n").unwrap();
        let mcp = McpVault::open(root.path()).unwrap();
        assert!(mcp.read_note("メモ.txt").is_err());
        assert!(mcp.read_note(IGNORE_FILE).is_err());
    }

    #[test]
    fn test_create_note_front_matter_の下に見出しを置く() {
        let (root, _vault) = temp_vault();
        let mcp = McpVault::open(root.path()).unwrap();
        let made = mcp
            .create_note("設計", Some("---\ntags: [a]\n---\n本文\n"), None, None)
            .unwrap();
        let text = fs::read_to_string(root.path().join(&made.path)).unwrap();
        assert!(
            text.starts_with("---\ntags: [a]\n---\n# 設計\n\n本文\n"),
            "{text:?}"
        );
        // front matter の下に既に見出しがあれば置かない
        let made = mcp
            .create_note(
                "設計2",
                Some("---\ntags: [a]\n---\n# 設計2\n\n本文\n"),
                None,
                None,
            )
            .unwrap();
        let text = fs::read_to_string(root.path().join(&made.path)).unwrap();
        assert_eq!(text.matches("# 設計2").count(), 1, "{text:?}");
    }

    #[test]
    fn test_list_folders_見せないノートは数えない() {
        let (root, _vault) = temp_vault();
        note(root.path(), "仕事/a.md", "# a\n");
        note(root.path(), "仕事/b.md", "# b\n");
        fs::write(root.path().join(".mcp-ignore"), "仕事/b.md\n").unwrap();
        let mcp = McpVault::open(root.path()).unwrap();
        let folders = mcp.list_folders().unwrap();
        assert_eq!(
            folders.iter().find(|(f, _)| f == "仕事").map(|(_, n)| *n),
            Some(1)
        );
    }

    #[test]
    fn test_move_note_行き先へ移し_履歴も連れて行く() {
        use chrono::NaiveDate;
        let (root, vault) = temp_vault();
        note(root.path(), "設計.md", "# 設計\n\n本文\n");
        fs::create_dir_all(root.path().join("仕事")).unwrap();
        fs::write(root.path().join(".mcp-ignore"), "秘密\n").unwrap();
        fs::create_dir_all(root.path().join("秘密")).unwrap();
        let store = crate::history::store_root(&vault.managed_dir());
        let at = NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:設計.md", "前の本文", at, true, 0).unwrap();

        let mcp = McpVault::open(root.path()).unwrap();
        let moved = mcp.move_note("設計.md", "仕事").unwrap();
        assert_eq!(moved.path, "仕事/設計.md");
        assert!(root.path().join("仕事/設計.md").is_file());
        assert!(!root.path().join("設計.md").exists());
        // 鍵はファイルに付いて回る（ADR-0042）
        assert_eq!(mcp.note_history("仕事/設計.md").unwrap().len(), 1);

        assert!(mcp.move_note("仕事/設計.md", "秘密").is_err());
        assert!(mcp.move_note("仕事/設計.md", "../外").is_err());
    }

    #[test]
    fn test_trash_note_ゴミ箱へ入れる_ピン留めは断る_空にはしない() {
        let (root, _vault) = temp_vault();
        note(root.path(), "要らない.md", "# 要らない\n");
        note(root.path(), "大事.md", "---\npinned: true\n---\n# 大事\n");
        let mcp = McpVault::open(root.path()).unwrap();

        let trashed = mcp.trash_note("要らない.md").unwrap();
        assert_eq!(trashed.path, ".trash/要らない.md");
        // **消さない。** ゴミ箱の中に在る
        assert!(root.path().join(".trash/要らない.md").is_file());
        assert!(!root.path().join("要らない.md").exists());

        // ピン留め中は捨てない（spec §7.3。先にピンを外す一拍を挟む）
        assert!(mcp.trash_note("大事.md").is_err());
        assert!(root.path().join("大事.md").is_file());
        // ゴミ箱の中身には触れない（空にする道は作らない）
        assert!(mcp.trash_note(".trash/要らない.md").is_err());
    }

    #[test]
    fn test_read_note_長い本文は先頭だけにして続きがある印() {
        let (root, _vault) = temp_vault();
        let long: String = (0..5000).map(|i| format!("行 {i}\n")).collect();
        note(root.path(), "長い.md", &long);
        let mcp = McpVault::open(root.path()).unwrap();
        let read = mcp.read_note("長い.md").unwrap();
        assert!(read.text.chars().count() <= MAX_TEXT_CHARS + 100);
        assert!(read.truncated);
        assert!(read.text.ends_with(TRUNCATED_MARK));
    }
}
