// アプリそのもの: メニューの印・MCP の設定・索引の同期・窓・ショートカット・購読。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import { CAPTURE_LABEL, captureUrl } from "./capture";
import type { McpHidden } from "./mcp-hidden";
import type { MenuChecks } from "./menu-checks";
import { listen } from "@tauri-apps/api/event";
import { safeSubscribe } from "./subscribe";

/// 使い方のノートを今の内容で置き直す。置いた場所を返す。
export async function placeManual(root: string): Promise<string> {
  return invoke<string>("manual_place", { root });
}

/// メニューの印（✓）を今の状態に合わせる。**決めるのは画面側**（T2）で、
/// Rust は言われたとおりに付け外しする
export async function setMenuChecks(state: MenuChecks): Promise<void> {
  return invoke("menu_checks", { state });
}

/// Claude に渡さない場所（`.mcp-ignore` に書いたもの + 最初から見せない場所）。
export async function mcpHidden(root: string): Promise<McpHidden> {
  return invoke<McpHidden>("mcp_hidden", { root });
}

/// 「Claude に渡さない」を付け外しする。付け外したあとの一覧を返す。
export async function setMcpHidden(
  root: string,
  path: string,
  hidden: boolean,
): Promise<McpHidden> {
  return invoke<McpHidden>("mcp_set_hidden", { root, path, hidden });
}

/// Claude Desktop の設定に貼る JSON 断片（10-6）。バイナリと保管フォルダの
/// 場所はアプリ側が知っている — 手で打たせない
export async function mcpConfig(root: string): Promise<string> {
  return invoke<string>("mcp_config", { root });
}

/// MCP の手引きのノートを置く。置いた場所を返す。
export async function placeMcpManual(root: string): Promise<string> {
  return invoke<string>("mcp_manual_place", { root });
}

/// 走査の結果（M-6）。「何も起きなかった」と「壊れている」を分けるために
/// 何件動いたかを返す。
export type SyncResult = { added: number; updated: number; removed: number };

/// ファイルと索引を手で合わせ直す。始めたら true、走査中なら false。
/// 終わりは "index-synced" イベントで届く。
export async function syncIndex(root: string, full: boolean): Promise<boolean> {
  return invoke<boolean>("index_sync", { root, full });
}

/// 保管フォルダの外部変更（watcher）。`kind` は "modified" / "removed" など
export type VaultChange = { path: string; kind: string };

/// 外部変更を受ける。返り値で購読を外す
export function subscribeVaultChanged(
  handler: (change: VaultChange) => void,
): () => void {
  return safeSubscribe(() =>
    listen<VaultChange>("vault-changed", (event) => handler(event.payload)),
  );
}

// ---- ウィンドウ

/// タイトルバーの文字を変える（要望 2026-09-10）。失敗しても本文には
/// 関係ないので、呼ぶ側は待たなくてよい
export async function setWindowTitle(title: string): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

// ---- どこからでも書き取りの窓（ADR-0057）。プラグインは動的 import で
// 読む（Tauri の外 = 素のブラウザでは読めない）。hook や部品はここを通す
// （ADR-0049。直接 import すると差し替えて試せない）

/// OS のグローバルショートカットを登録し、押されたら `onPressed`
export async function registerGlobalShortcut(
  key: string,
  onPressed: () => void,
): Promise<void> {
  const { register } = await import("@tauri-apps/plugin-global-shortcut");
  await register(key, (event) => {
    if (event.state === "Pressed") onPressed();
  });
}

export async function unregisterGlobalShortcut(key: string): Promise<void> {
  const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
  await unregister(key);
}

/// 書き取りの窓を出す（既にあれば前へ）
export async function openCaptureWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CAPTURE_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(CAPTURE_LABEL, {
    url: captureUrl(),
    title: "書き取り",
    width: 520,
    height: 260,
    minWidth: 320,
    minHeight: 160,
    center: true,
    alwaysOnTop: true,
    focus: true,
  });
}

/// 今いる窓を閉じる（書き取りの窓が送ったあと）
export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

/// 起動 → UI マウントの実測（spec §6.6）
export function startupElapsedMs(): Promise<number> {
  return invoke<number>("startup_elapsed_ms", {});
}

/// 背景の索引同期が終わった知らせ
export function subscribeIndexUpdated(handler: () => void): () => void {
  return safeSubscribe(() => listen("index-updated", () => handler()));
}

/// 走査の結果（M-6）。`full` は全部を見直したか
export function subscribeIndexSynced(
  handler: (full: boolean, result: SyncResult) => void,
): () => void {
  return safeSubscribe(() =>
    listen<[boolean, SyncResult]>("index-synced", (event) =>
      handler(event.payload[0], event.payload[1]),
    ),
  );
}

/// 索引の同期の失敗（理由の文）
export function subscribeIndexSyncFailed(
  handler: (message: string) => void,
): () => void {
  return safeSubscribe(() =>
    listen<string>("index-sync-failed", (event) => handler(event.payload)),
  );
}

/// ネイティブのメニューが押された（項目の id）
export function subscribeMenu(handler: (id: string) => void): () => void {
  return safeSubscribe(() =>
    listen<string>("menu", (event) => handler(event.payload)),
  );
}
