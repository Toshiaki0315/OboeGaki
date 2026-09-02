// アプリ状態（Zustand）。ここに置くのは vault のパス・ノート一覧・選択まで。
// **文書の内容と編集状態は EditorView が持つ。ここにミラーしない（T2）。**

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

type AppState = {
  vaultRoot: string | null;
  notes: string[];
  currentPath: string | null;
  openVault: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (path: string | null) => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  vaultRoot: null,
  notes: [],
  currentPath: null,

  async openVault(root) {
    const notes = await invoke<string[]>("vault_open", { root });
    set({ vaultRoot: root, notes, currentPath: null });
  },

  async refresh() {
    const root = get().vaultRoot;
    if (!root) return;
    const notes = await invoke<string[]>("vault_open", { root });
    set({ notes });
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

export async function createNote(root: string, title: string): Promise<string> {
  return invoke<string>("note_create", { root, title });
}

export async function renameNote(
  root: string,
  path: string,
  title: string,
): Promise<string> {
  return invoke<string>("note_rename", { root, path, title });
}

export async function trashNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_trash", { root, path });
}
