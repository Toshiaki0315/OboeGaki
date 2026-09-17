// アプリ状態（Zustand）。ここに置くのは vault のパス・ノート一覧・選択まで。
// **文書の内容と編集状態は EditorView が持つ。ここにミラーしない（T2）。**
// Rust を呼ぶ包みは lib/ipc にある。

import { create } from "zustand";
import {
  fetchLists,
  openVaultRoot,
  type FolderCount,
  type TagCount,
  type TaskRow,
  type TrashEntry,
} from "../lib/ipc";
import type { NoteEntry } from "../lib/note-order";

type AppState = {
  vaultRoot: string | null;
  notes: NoteEntry[];
  tags: TagCount[];
  folders: FolderCount[];
  trashNotes: TrashEntry[];
  /// 未完了のやること（ADR-0056）
  tasks: TaskRow[];
  currentPath: string | null;
  /// `trashDays` は環境設定のゴミ箱の日数（省くと Rust 側の既定）
  openVault: (root: string, trashDays?: number) => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (path: string | null) => void;
};

// 一覧の取り寄せの世代。**追い越しを捨てる** — 2 本並んで先発が後に解決すると
// 古い一覧が勝っていた（棚卸し 2026-09-17）。保管フォルダを変えたあとに届いた
// 前のフォルダの一覧も捨てる
let generation = 0;

export const useAppStore = create<AppState>((set, get) => ({
  vaultRoot: null,
  notes: [],
  tags: [],
  folders: [],
  trashNotes: [],
  tasks: [],
  currentPath: null,

  async openVault(root, trashDays) {
    // レイアウト作成・監視開始・背景の索引同期を起動してから一覧を引く
    await openVaultRoot(root, trashDays);
    const mine = ++generation;
    const lists = await fetchLists(root);
    if (mine !== generation) return; // もっと新しい取り寄せが走った
    set({ vaultRoot: root, ...lists, currentPath: null });
  },

  async refresh() {
    const root = get().vaultRoot;
    if (!root) return;
    const mine = ++generation;
    const lists = await fetchLists(root);
    if (mine !== generation || get().vaultRoot !== root) return;
    set(lists);
  },

  selectNote(path) {
    set({ currentPath: path });
  },
}));
