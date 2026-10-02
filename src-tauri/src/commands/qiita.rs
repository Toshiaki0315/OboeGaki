// Qiita への投稿（TASKS 第 14 群 / ADR-0063）。Tauri commands の薄い層（T3）。
// 分け方は commands/mod.rs を見る。
//
// **トークンを返す命令は作らない。** 画面が知るのは「入っているか」だけ（14-1）。

use super::{CmdError, CmdResult};
use crate::qiita::{self, Keychain};

/// トークンを Keychain に入れる（環境設定「Qiita」タブ）
#[tauri::command]
pub fn qiita_token_set(token: String) -> CmdResult<()> {
    qiita::save_token(&Keychain, &token).map_err(CmdError)
}

/// トークンが入っているか（値は返さない）
#[tauri::command]
pub fn qiita_token_saved() -> bool {
    qiita::token_saved(&Keychain)
}

/// トークンを Keychain から消す
#[tauri::command]
pub fn qiita_token_clear() -> CmdResult<()> {
    qiita::clear_token(&Keychain).map_err(CmdError)
}
