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

/// 投稿の結果。text は front matter（記事 ID と更新時刻）を書き戻した本文
export type QiitaPublished = { text: string; url: string; created: boolean };

/// ノートを Qiita へ出す（front matter に `qiita:` があれば更新、無ければ限定共有で新規）。
/// 送る形は qiitaDraft が整えたもの。失敗は理由の文字で reject する
export async function qiitaPublish(
  root: string,
  path: string,
  draft: { title: string; body: string; tags: string[] },
): Promise<QiitaPublished> {
  return invoke<QiitaPublished>("qiita_publish", { root, path, draft });
}
