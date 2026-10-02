// Qiita への投稿（TASKS 第 14 群 / ADR-0063）。送るのは Rust 側で、**トークンは
// WebView に戻ってこない**（入れる・入っているか・消すの 3 つだけ）。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";

/// トークンを Keychain に入れる。形が違えば理由の文字で失敗する
export async function qiitaTokenSet(token: string): Promise<void> {
  await invoke("qiita_token_set", { token });
}

/// トークンが入っているか（値は返らない）
export async function qiitaTokenSaved(): Promise<boolean> {
  return invoke<boolean>("qiita_token_saved");
}

/// トークンを Keychain から消す
export async function qiitaTokenClear(): Promise<void> {
  await invoke("qiita_token_clear");
}
