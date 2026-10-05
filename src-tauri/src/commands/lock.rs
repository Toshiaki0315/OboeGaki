// 施錠ノート（TASKS 第 13 群 / ADR-0062）の解錠・施錠と読み書き。Tauri commands の
// 薄い層（T3）。暗号は crate::lock、保管フォルダでの読み書きは vault::locked。
//
// **鍵は WatchState の中だけ**にあり、画面には渡さない。画面が知るのは「施錠ノートが
// あるか・解錠しているか」だけ。

use super::{CmdError, CmdResult, WatchState};
use crate::lock::Key;
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

    /// 鍵を借りて施錠ノートを読む。鍵が無ければ NOTE_LOCKED
    pub(crate) fn read_locked(&self, path: &Path) -> CmdResult<String> {
        let held = self
            .key
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(key) = held.as_ref() else {
            return Err(CmdError(NOTE_LOCKED.into()));
        };
        crate::vault::read_locked(path, key).map_err(|error| CmdError(error.to_string()))
    }

    /// 鍵を借りて施錠ノートに書く（暗号文だけ。版も退避も残さない）
    pub(crate) fn write_locked(&self, path: &Path, text: &str) -> CmdResult<()> {
        let held = self
            .key
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(key) = held.as_ref() else {
            return Err(CmdError(NOTE_LOCKED.into()));
        };
        crate::vault::write_locked(path, key, text).map_err(|error| CmdError(error.to_string()))
    }
}
