// 版の履歴・競合の写し・未保存の退避と復元（Rust の history_* / recovery_*）。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";

/// 前回の未保存内容（クラッシュ退避）。`stashedAtMs` は退避した時刻。
export type Stashed = {
  source: string;
  text: string;
  stashed_at_ms: number;
};

/// 未保存の内容を退避する（保存できないまま落ちたときの保険）。
export async function stashNote(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await invoke("recovery_stash", { root, path, text });
}

export async function discardStash(root: string, path: string): Promise<void> {
  await invoke("recovery_discard", { root, path });
}

export async function pendingRecovery(root: string): Promise<Stashed[]> {
  return invoke<Stashed[]>("recovery_pending", { root });
}

/// 退避を別ファイルとして書き出す。書いた場所が返る。
export async function restoreRecovery(root: string): Promise<string[]> {
  return invoke<string[]>("recovery_restore", { root });
}

export async function clearRecovery(root: string): Promise<void> {
  await invoke("recovery_clear", { root });
}

/// 競合の「両方残す」: 自分の版を競合コピーに保存し、その場所を返す。
export async function conflictCopy(
  root: string,
  path: string,
  text: string,
): Promise<string> {
  return invoke<string>("conflict_copy", { root, path, text });
}

export type HistoryEntry = { stamp: string; path: string };

export async function historyList(
  root: string,
  path: string,
): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("history_list", { root, path });
}

/// 版を書き戻す。返り値は書き戻したあとの本文。
/// 版の本文を読む（差分表示。書き戻さない = ADR-0054）
export async function historyRead(
  root: string,
  path: string,
  version: string,
): Promise<string> {
  return invoke<string>("history_read", { root, path, version });
}

export async function historyRestore(
  root: string,
  path: string,
  version: string,
): Promise<string> {
  return invoke<string>("history_restore", { root, path, version });
}

/// 履歴フォルダの大きさ（バイト）
export function historyUsage(root: string): Promise<number> {
  return invoke<number>("history_usage", { root });
}
