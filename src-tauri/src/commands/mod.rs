// Tauri commands。フロントとの境界の薄い層で、ロジックは持たない（T3）。
// パスを受け取る command は必ず vault::contains で封じ込めを確認する。
// ファイルを動かす command は Suppressor に記録し、自分の書き込みが
// 「外部変更」としてフロントへ跳ね返らないようにする（spec §7.5）。
//
// 20-4: 領域ごとの子モジュールに分けた。外から見える名前は `pub use` で変えない
// （lib.rs の generate_handler! は `commands::xxx` のまま）。ここに残すのは
// 全部の子が使う土台（CmdError・WatchState・封じ込め・base64・索引の 1 件更新）

mod app;
mod assets;
mod folders;
mod history;
mod llm;
mod notes;
mod recovery;
mod system;
mod text;
mod trash;

pub use app::*;
pub use assets::*;
pub use folders::*;
pub use history::*;
pub use llm::*;
pub use notes::*;
pub use recovery::*;
pub use system::*;
pub use text::*;
pub use trash::*;

use crate::index_db::IndexDb;
use crate::vault::{contains, Vault};
use crate::watcher::Suppressor;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// コマンドの失敗。画面には文字で渡す（serde で `String` になる）。
/// 以前は 66 か所で `map_err(|e| e.to_string())` を手書きしていた — 写像の抜けが
/// 「型が合わず 3 行増える」形で毎回出ていた（19-3。2026-09-18）。`?` で揃える
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CmdError(pub String);

pub type CmdResult<T> = Result<T, CmdError>;

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// テストや呼び手が `contains` / `starts_with` を文字のまま使えるように
impl std::ops::Deref for CmdError {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl PartialEq<str> for CmdError {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for CmdError {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

macro_rules! cmd_error_from {
    ($($ty:ty),* $(,)?) => {
        $(impl From<$ty> for CmdError {
            fn from(error: $ty) -> Self {
                CmdError(error.to_string())
            }
        })*
    };
}

cmd_error_from!(
    String,
    &str,
    std::io::Error,
    rusqlite::Error,
    serde_json::Error,
    tauri::Error,
    base64::DecodeError,
    crate::llm::LlmError,
);

/// vault ごとに 1 本の watcher と、自書き込みの無視リスト。
/// 新しい vault を開いたら watcher を置き換える（drop で旧監視は止まる）。
pub struct WatchState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    suppressor: Arc<Suppressor>,
    /// 開いている vault のロック（H-1 層 2）。**開いている間は持ち続ける**
    /// （手放すと OS がロックを外す）。別の vault を開いたら置き換える。
    lock: Mutex<Option<crate::vault_lock::VaultLock>>,
    /// 走査が動いているか（M-6）。**二重に走らせない** — 同じ索引を
    /// 2 本で書くと、片方の見た「消えた」がもう片方の書き込みを消す
    syncing: Arc<std::sync::atomic::AtomicBool>,
    /// 全走査（sync / rebuild）の直列化。syncing フラグは「押しても
    /// 無反応に見せない」ための表示用で、**vault_open の背景同期と
    /// folder_rename の同期はフラグを見ていなかった**（レビュー
    /// 2026-09-04）。実際の相互排除はこのロックが持つ
    sync_gate: Arc<Mutex<()>>,
    /// 生成が走っているか（TASKS 4-8）。**答えの途中でモデルを降ろさない**
    /// ためと、二重に始めないため
    generating: Arc<std::sync::atomic::AtomicBool>,
    /// 「止める」が押されたか（L-1）。生成を始めるたびに下ろす
    stop_generating: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            suppressor: Arc::new(Suppressor::default()),
            lock: Mutex::new(None),
            syncing: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            sync_gate: Arc::new(Mutex::new(())),
            generating: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stop_generating: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

/// フロント（lib/last-vault.ts）と揃える印。二重起動の断りだけに付ける。
const VAULT_BUSY: &str = "vault-busy";

/// ゴミ箱に置いておく日数の既定（spec §7.6）。環境設定で変えられる
/// （フロントの lib/settings.ts と同じ値）。
const DEFAULT_TRASH_DAYS: u64 = 30;

// 重いコマンド（OCR・LLM のプローブ・取り込み・全 md 走査・毎打鍵の保存）
// は `async fn` にしてメインスレッドから逃がす（レビュー 2026-09-04）。
// Tauri は同期コマンドをメインスレッドで実行するため、Ollama 未導入の
// 環境では 3 秒のプローブのたびに UI が固まっていた。body は同期のままで
// よい（同時に走る重いコマンドは高々数本で、tokio のワーカーを枯らさない）。

/// AtomicBool を「スレッドが終わったら必ず戻す」ための番人。
/// クロージャの末尾で store すると、途中のパニックで立ちっぱなしになり、
/// 以降その機能（LLM・手動同期）が再起動まで死ぬ（レビュー 2026-09-04）。
struct FlagGuard(Arc<std::sync::atomic::AtomicBool>);

impl Drop for FlagGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

fn guarded(root: &str, path: &str) -> CmdResult<std::path::PathBuf> {
    let candidate = Path::new(path).to_path_buf();
    if contains(Path::new(root), &candidate) {
        // 検査したのと同じ実体を使う（生のパスを返すと、検査と使用の間に
        // シンボリックリンクへ差し替えられる余地が残る — レビュー 2026-09-04）。
        // まだ無いファイル（これから書く）は正規化できないので生のまま
        Ok(candidate.canonicalize().unwrap_or(candidate))
    } else {
        Err(format!("vault の外を指しています: {path}").into())
    }
}

fn decode(data: &str) -> CmdResult<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(CmdError::from)
}

/// 作ったばかりの 1 ファイルを索引へ。失敗しても作成自体は成功なので
/// ログだけ残す（全体の整合は vault_open の同期が取り直す）。
fn index_one(vault: &Vault, path: &Path) {
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(vault, path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
}
