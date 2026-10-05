// 施錠ノート（TASKS 第 13 群 / ADR-0062）。鍵は Rust の中だけにあり、ここは
// 「施錠ノートがあるか・解錠しているか」を聞き、解錠・施錠を頼むだけ。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";

/// 鍵が無くて施錠ノートを読めなかった（Rust の commands::NOTE_LOCKED と同じ字面）
export const NOTE_LOCKED = "note-locked";

export type LockState = { hasLockedNotes: boolean; unlocked: boolean };

export function lockState(root: string): Promise<LockState> {
  return invoke<LockState>("lock_state", { root });
}

/// パスワードで解錠する。違えば理由の文字で reject する
export async function lockUnlock(
  root: string,
  password: string,
): Promise<void> {
  await invoke("lock_unlock", { root, password });
}

/// 施錠する（鍵を消す）
export async function lockForget(): Promise<void> {
  await invoke("lock_forget");
}
