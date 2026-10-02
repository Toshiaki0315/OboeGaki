// Qiita への投稿（TASKS 第 14 群 / ADR-0063）。Tauri commands の薄い層（T3）。
// 分け方は commands/mod.rs を見る。
//
// **トークンを返す命令は作らない。** 画面が知るのは「入っているか」だけ（14-1）。

use super::{guarded, index_one, CmdError, CmdResult, WatchState};
use crate::qiita::{self, Draft, Keychain, SecretStore, Ureq};
use crate::vault::Vault;

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

/// 投稿の結果。text は front matter を書き戻した本文（開いているエディタが読み直す）
#[derive(serde::Serialize)]
pub struct Published {
    pub text: String,
    pub url: String,
    /// 新しく作った（限定共有で出した）か、既にある記事を更新したか
    pub created: bool,
}

/// ノートを Qiita へ出す（14-3 / 14-4 / 14-6）。送る形は TS の qiitaDraft が整えた
/// draft。front matter に `qiita:` があれば更新、無ければ限定共有で新規。成功したら
/// 記事 ID と更新時刻を front matter に書き戻す。**トークンは Rust の中だけで使う**。
/// 通信は待つので async（メインスレッドから逃がす）
#[tauri::command]
pub async fn qiita_publish(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    draft: Draft,
) -> CmdResult<Published> {
    let path = guarded(&root, &path)?;
    let token = Keychain
        .get()
        .ok()
        .flatten()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            CmdError("トークンが入っていません。環境設定の「Qiita」で入れてください".into())
        })?;
    let text = crate::vault::read_note(&path)?;
    let known = qiita::known_of(&text);
    let remote =
        qiita::publish(&Ureq::default(), &token, &draft, known.as_ref()).map_err(CmdError)?;
    // 送ったあとで本文が変わっていても（通信の間に保存された）、書き戻すのは今の本文に
    let current = crate::vault::read_note(&path)?;
    let updated = qiita::record(&current, &remote);
    if updated != current {
        let vault = Vault::new(&root);
        state.suppressor.mark(&path);
        vault.write_with_version(&path, &current, &updated)?;
        index_one(&vault, &path);
    }
    Ok(Published {
        text: updated,
        url: remote.url,
        created: known.is_none(),
    })
}
