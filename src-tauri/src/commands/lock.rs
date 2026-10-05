// 施錠ノート（TASKS 第 13 群 / ADR-0062）の解錠・施錠と読み書き。Tauri commands の
// 薄い層（T3）。暗号は crate::lock、保管フォルダでの読み書きは vault::locked。
//
// **鍵は WatchState の中だけ**にあり、画面には渡さない。画面が知るのは「施錠ノートが
// あるか・解錠しているか」だけ。

use super::{guarded, CmdError, CmdResult, WatchState};
use crate::index_db::IndexDb;
use crate::lock::{Key, Params};
use crate::vault::Vault;
use std::path::Path;

/// 施錠ノートを開こうとしたが鍵が無い（フロントはこの字面で解錠の窓を出す）
pub const NOTE_LOCKED: &str = "note-locked";

/// 施錠の今の様子
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockState {
    /// 保管フォルダに施錠ノートがあるか（無ければ最初の施錠でパスワードを決める）
    pub has_locked_notes: bool,
    pub unlocked: bool,
}

#[tauri::command]
pub fn lock_state(state: tauri::State<'_, WatchState>, root: String) -> LockState {
    LockState {
        has_locked_notes: !Vault::new(&root).scan_locked().is_empty(),
        unlocked: state.key_held(),
    }
}

/// パスワードで解錠する（既にある施錠ノートを 1 つ開けてみて確かめる）。
/// 鍵の導出は重い（約 80ms）ので async
#[tauri::command]
pub async fn lock_unlock(
    state: tauri::State<'_, WatchState>,
    root: String,
    password: String,
) -> CmdResult<()> {
    let key = crate::vault::unlock(&Vault::new(&root), &password)
        .map_err(|error| CmdError(error.to_string()))?;
    state.set_key(Some(key));
    Ok(())
}

/// 施錠する（鍵を消す）。自動施錠もここ
#[tauri::command]
pub fn lock_forget(state: tauri::State<'_, WatchState>) {
    state.set_key(None);
}

impl WatchState {
    pub(crate) fn set_key(&self, key: Option<Key>) {
        *self
            .key
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = key;
    }

    pub(crate) fn key_held(&self) -> bool {
        self.key.lock().map(|key| key.is_some()).unwrap_or(false)
    }

    /// 鍵を借りて使う。鍵が無ければ NOTE_LOCKED
    fn with_key<T>(
        &self,
        work: impl FnOnce(&Key) -> Result<T, crate::lock::LockError>,
    ) -> CmdResult<T> {
        let held = self
            .key
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(key) = held.as_ref() else {
            return Err(CmdError(NOTE_LOCKED.into()));
        };
        work(key).map_err(|error| CmdError(error.to_string()))
    }

    /// 鍵を借りて施錠ノートを読む
    pub(crate) fn read_locked(&self, path: &Path) -> CmdResult<String> {
        self.with_key(|key| crate::vault::read_locked(path, key))
    }

    /// 鍵を借りて施錠ノートに書く（暗号文だけ。版も退避も残さない）
    pub(crate) fn write_locked(&self, path: &Path, text: &str) -> CmdResult<()> {
        self.with_key(|key| crate::vault::write_locked(path, key, text))
    }
}

/// 鍵が無ければパスワードで持つ。保管フォルダに施錠ノートが無ければ、そのパスワードで
/// 新しい鍵を作る（最初の施錠。画面が 2 回打たせて確かめてから呼ぶ）。あれば確かめる
fn ensure_key(state: &WatchState, vault: &Vault, password: Option<String>) -> CmdResult<()> {
    if state.key_held() {
        return Ok(());
    }
    let password = password.ok_or_else(|| CmdError(NOTE_LOCKED.into()))?;
    let key = if vault.scan_locked().is_empty() {
        Key::create(&password, Params::DEFAULT)
    } else {
        crate::vault::unlock(vault, &password)
    }
    .map_err(|error| CmdError(error.to_string()))?;
    state.set_key(Some(key));
    Ok(())
}

/// 索引の行を付け替える（施錠・解除でファイルの名前が変わる）
fn reindex(vault: &Vault, before: &Path, after: &Path) {
    if let Err(error) = IndexDb::open(&vault.local_dir()).and_then(|mut db| {
        db.remove(vault, before)?;
        db.upsert(vault, after)
    }) {
        eprintln!("索引の更新に失敗した: {error}");
    }
}

/// ノートを施錠する（`.md` → `.md.enc`。13-5）。施錠したノートの場所を返す。
/// 鍵が無ければ password が要る（無ければ NOTE_LOCKED）
#[tauri::command]
pub async fn note_lock(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    password: Option<String>,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    ensure_key(&state, &vault, password)?;
    state.suppressor.mark(&path);
    let target = state.with_key(|key| crate::vault::lock_note(&vault, &path, key))?;
    state.suppressor.mark(&target);
    reindex(&vault, &path, &target);
    Ok(target.to_string_lossy().into_owned())
}

/// 施錠を外す（`.md.enc` → `.md`）。戻したノートの場所を返す
#[tauri::command]
pub fn note_unlock(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    state.suppressor.mark(&path);
    let target = state.with_key(|key| crate::vault::unlock_note(&path, key))?;
    state.suppressor.mark(&target);
    reindex(&vault, &path, &target);
    Ok(target.to_string_lossy().into_owned())
}

/// パスワードを変える（施錠ノートを全部書き直す）。書き直した数を返す
#[tauri::command]
pub async fn lock_change_password(
    state: tauri::State<'_, WatchState>,
    root: String,
    old: String,
    new: String,
) -> CmdResult<usize> {
    let vault = Vault::new(&root);
    let error = |error: crate::lock::LockError| CmdError(error.to_string());
    let old_key = crate::vault::unlock(&vault, &old).map_err(error)?;
    let new_key = Key::create(&new, Params::DEFAULT).map_err(error)?;
    let changed = crate::vault::change_key(&vault, &old_key, &new_key).map_err(error)?;
    state.set_key(Some(new_key));
    Ok(changed)
}
