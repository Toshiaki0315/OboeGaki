// アプリ状態（Zustand）。ここに置くのは vault のパス・ノート一覧・選択まで。
// **文書の内容と編集状態は EditorView が持つ。ここにミラーしない（T2）。**
// Rust を呼ぶ包みは lib/ipc にある。

import { create } from "zustand";
import {
  fetchLists,
  openVaultRoot,
  type FolderCount,
  type TagCount,
  type TrashEntry,
} from "../lib/ipc";
import type { NoteEntry } from "../lib/note-order";

type AppState = {
  vaultRoot: string | null;
  notes: NoteEntry[];
  tags: TagCount[];
  folders: FolderCount[];
  trashNotes: TrashEntry[];
  currentPath: string | null;
  /// `trashDays` は環境設定のゴミ箱の日数（省くと Rust 側の既定）
  openVault: (root: string, trashDays?: number) => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (path: string | null) => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  vaultRoot: null,
  notes: [],
  tags: [],
  folders: [],
  trashNotes: [],
  currentPath: null,

  async openVault(root, trashDays) {
    // レイアウト作成・監視開始・背景の索引同期を起動してから一覧を引く
    await openVaultRoot(root, trashDays);
    const lists = await fetchLists(root);
    set({ vaultRoot: root, ...lists, currentPath: null });
  },

  async refresh() {
    const root = get().vaultRoot;
    if (!root) return;
    set(await fetchLists(root));
  },

  selectNote(path) {
    set({ currentPath: path });
  },
}));
