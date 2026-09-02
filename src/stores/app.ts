// アプリ状態（Zustand）。ここに置くのは vault のパス・ノート一覧・選択まで。
// **文書の内容と編集状態は EditorView が持つ。ここにミラーしない（T2）。**

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type AppState = {
  vaultRoot: string | null;
  notes: string[];
  currentPath: string | null;
  openVault: (root: string) => Promise<void>;
  selectNote: (path: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  vaultRoot: null,
  notes: [],
  currentPath: null,

  async openVault(root) {
    const notes = await invoke<string[]>("vault_open", { root });
    set({ vaultRoot: root, notes, currentPath: null });
  },

  selectNote(path) {
    set({ currentPath: path });
  },
}));

export async function readNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_read", { root, path });
}

export async function writeNote(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await invoke("note_write", { root, path, text });
}
