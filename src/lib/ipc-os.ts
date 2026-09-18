// OS の窓と外部: 確認・ファイル選択・Finder・外部 URL・クリップボード・生成 AI への手渡し。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";

/// Finder で開く。**開ける先は保管フォルダの中だけ**（中かどうかは Rust が確かめる）
export function openInFinder(root: string, path: string): Promise<void> {
  return invoke("open_in_finder", { root, path });
}

/// 外のアプリの URL スキーム／辞書を開く（許した綴りだけ。Rust が見る）
export function openHandoffUrl(url: string): Promise<void> {
  return invoke("open_handoff_url", { url });
}

/// 外のアプリを名前で開く（許した名前だけ。Rust が見る）
export function openHandoffApp(app: string): Promise<void> {
  return invoke("open_handoff_app", { app });
}

/// 確認の窓（OK なら true）
export function confirmDialog(
  message: string,
  options?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<boolean> {
  return confirm(message, options);
}

export type FileFilter = { name: string; extensions: string[] };

/// ファイルを 1 つ選ぶ。選ばなければ null
export async function pickFile(options: {
  filters?: FileFilter[];
}): Promise<string | null> {
  const picked = await open({ multiple: false, ...options });
  return typeof picked === "string" ? picked : null;
}

/// フォルダを 1 つ選ぶ。選ばなければ null
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true });
  return typeof picked === "string" ? picked : null;
}

/// 保存先を選ぶ。やめれば null
export function saveTo(options: {
  defaultPath?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  return save(options);
}

/// 既定のブラウザで開く
export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}

/// Finder でファイルを見せる
export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path);
}

/// クリップボード。**Rust 側から触る** — WebView の `navigator.clipboard.readText()`
/// は許可が下りず、貼り付けが動かなかった（実機報告 2026-09-04）
export function readClipboardText(): Promise<string> {
  return readClipboard();
}

export function writeClipboardText(text: string): Promise<void> {
  return writeClipboard(text);
}
