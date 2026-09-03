// 外部変更の検知（spec §7.5）。参照実装 storage/watcher.py の移植。
//
// notify で vault を再帰監視し、関係あるイベントだけを Tauri イベント
// "vault-changed" としてフロントへ流す。自分で書いた直後のイベントは
// 無視リスト（保存直後 1.5 秒間、そのパスを抑制）で除外する。
// 変更にどう反応するか（リロード・競合の扱い）はフロント側の判断。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;

/// 自分の書き込みを外部変更と取り違えないための無視リスト。
///
/// 保存直後 1.5 秒間、そのパスのイベントを抑制する（spec §7.5）。
/// FSEvents はこちらの rename も外部の編集も同じ顔で届けるため、
/// 時刻で区別するしかない。
pub struct Suppressor {
    window: Duration,
    entries: Mutex<HashMap<PathBuf, Instant>>,
}

pub const SUPPRESS_WINDOW: Duration = Duration::from_millis(1500);

impl Suppressor {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// このパスへ今書いた、と記録する。
    pub fn mark(&self, path: &Path) {
        self.entries
            .lock()
            .expect("suppressor lock")
            .insert(path.to_path_buf(), Instant::now());
    }

    /// 抑制中か。窓を過ぎた記録はこの機会に捨てる。
    pub fn is_suppressed(&self, path: &Path) -> bool {
        let mut entries = self.entries.lock().expect("suppressor lock");
        let now = Instant::now();
        entries.retain(|_, marked| now.duration_since(*marked) < self.window);
        entries.contains_key(path)
    }
}

impl Default for Suppressor {
    fn default() -> Self {
        Self::new(SUPPRESS_WINDOW)
    }
}

/// このイベントをフロントへ知らせる価値があるか。
///
/// vault 内の Markdown だけ。`.trash`・管理フォルダなどの除外規則は
/// `vault::scan` と同じでなければならない（一覧には出ないのに通知は来る、
/// という食い違いを作らない）。一時ファイル（.tmp）も外す。
pub fn is_relevant(root: &Path, path: &Path) -> bool {
    if !crate::vault::is_markdown(path) {
        return false;
    }
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let std::path::Component::Normal(name) = component else {
            return false;
        };
        // フォルダ成分に scan と同じ除外規則を当てる（最後の成分はファイル名）
        if components.peek().is_some() {
            let name = name.to_str().unwrap_or("");
            if crate::vault::SKIP_DIRS.contains(&name) || name.starts_with('.') {
                return false;
            }
        }
    }
    true
}

#[derive(Clone, serde::Serialize)]
pub struct ChangePayload {
    pub path: String,
    pub kind: &'static str,
}

/// vault の再帰監視を開始する。返った watcher を保持している間だけ生きる
/// （drop で止まるので、新しい vault を開いたら置き換えるだけでよい）。
///
/// ここは notify と Tauri イベントの橋渡しだけの薄い層（T3 の例外部分）。
/// 判定ロジックは is_relevant / Suppressor に置き、そちらをテストする。
pub fn start(
    app: tauri::AppHandle,
    root: PathBuf,
    suppressor: Arc<Suppressor>,
) -> notify::Result<RecommendedWatcher> {
    let watch_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else { return };
        for path in event.paths {
            if !is_relevant(&root, &path) || suppressor.is_suppressed(&path) {
                continue;
            }
            // FSEvents は改名・削除・編集を同じ顔で届けることがあるので、
            // 今そこに在るかどうかで分類する
            let kind = if path.exists() { "changed" } else { "removed" };
            // 索引はここで直接追従させる（vault_open の全体同期を
            // 待たない）。失敗しても通知は流す — 表示の更新が先
            let vault = crate::vault::Vault::new(&root);
            let updated =
                crate::index_db::IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
                    if kind == "changed" {
                        db.upsert(&vault, &path)
                    } else {
                        db.remove(&vault, &path)
                    }
                });
            if let Err(error) = updated {
                eprintln!("外部変更を索引へ反映できなかった: {error}");
            }
            let _ = app.emit(
                "vault-changed",
                ChangePayload {
                    path: path.to_string_lossy().into_owned(),
                    kind,
                },
            );
        }
    })?;
    watcher.watch(&watch_root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{MANAGED_DIR, TRASH_DIR};

    #[test]
    fn test_suppressor_直後は抑制され窓を過ぎると解ける() {
        let path = Path::new("/v/a.md");
        let live = Suppressor::new(Duration::from_secs(60));
        live.mark(path);
        assert!(live.is_suppressed(path));

        let expired = Suppressor::new(Duration::ZERO);
        expired.mark(path);
        assert!(!expired.is_suppressed(path));
    }

    #[test]
    fn test_suppressor_記録していないパスは抑制しない() {
        let suppressor = Suppressor::new(Duration::from_secs(60));
        suppressor.mark(Path::new("/v/a.md"));
        assert!(!suppressor.is_suppressed(Path::new("/v/b.md")));
    }

    #[test]
    fn test_is_relevant_vault内のmarkdownだけを通す() {
        let root = Path::new("/v");
        assert!(is_relevant(root, Path::new("/v/a.md")));
        assert!(is_relevant(root, Path::new("/v/sub/深い.markdown")));
        assert!(!is_relevant(root, Path::new("/v/a.txt")));
        assert!(!is_relevant(root, Path::new("/other/a.md")));
    }

    #[test]
    fn test_is_relevant_scanと同じ除外規則を使う() {
        let root = Path::new("/v");
        assert!(!is_relevant(root, &root.join(TRASH_DIR).join("a.md")));
        assert!(!is_relevant(root, &root.join(MANAGED_DIR).join("a.md")));
        assert!(!is_relevant(root, Path::new("/v/attachments/a.md")));
        assert!(!is_relevant(root, Path::new("/v/templates/a.md")));
        assert!(!is_relevant(root, Path::new("/v/.hidden/a.md")));
        assert!(!is_relevant(root, Path::new("/v/sub/.hidden/a.md")));
    }

    #[test]
    fn test_is_relevant_一時ファイルと隠しファイルを外す() {
        let root = Path::new("/v");
        assert!(!is_relevant(root, Path::new("/v/.a.md.x1y2.tmp")));
        assert!(!is_relevant(root, Path::new("/v/.DS_Store")));
    }
}
