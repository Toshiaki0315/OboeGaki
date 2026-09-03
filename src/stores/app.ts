// アプリ状態（Zustand）。ここに置くのは vault のパス・ノート一覧・選択まで。
// **文書の内容と編集状態は EditorView が持つ。ここにミラーしない（T2）。**

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { NoteEntry } from "../lib/note-order";

type NoteMeta = {
  path: string; // vault からの相対パス
  title: string;
  preview: string;
  mtime_ms: number;
};

export type TagCount = { tag: string; count: number };

type AppState = {
  vaultRoot: string | null;
  notes: NoteEntry[];
  tags: TagCount[];
  trashNotes: string[];
  currentPath: string | null;
  openVault: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (path: string | null) => void;
};

async function fetchLists(root: string) {
  await invoke<string[]>("vault_open", { root }); // 索引同期と監視の開始
  const metas = await invoke<NoteMeta[]>("note_list", { root });
  const notes: NoteEntry[] = metas.map((meta) => ({
    path: `${root}/${meta.path}`,
    label: meta.path.replace(/\.(md|markdown)$/i, ""),
    preview: meta.preview,
    mtimeMs: meta.mtime_ms,
  }));
  const tagPairs = await invoke<[string, number][]>("tag_list", { root });
  const tags: TagCount[] = tagPairs.map(([tag, count]) => ({ tag, count }));
  const trashNotes = await invoke<string[]>("trash_list", { root });
  return { notes, tags, trashNotes };
}

export const useAppStore = create<AppState>((set, get) => ({
  vaultRoot: null,
  notes: [],
  tags: [],
  trashNotes: [],
  currentPath: null,

  async openVault(root) {
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

export async function restoreNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_restore", { root, path });
}

export type SearchHit = {
  /** vault からの相対パス */
  path: string;
  title: string;
  snippet: string;
};

export async function searchNotes(
  root: string,
  query: string,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("note_search", { root, query });
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
export async function historyRestore(
  root: string,
  path: string,
  version: string,
): Promise<string> {
  return invoke<string>("history_restore", { root, path, version });
}

// 画像の data URL キャッシュ。装飾は再計算のたびに widget を作り直すので、
// invoke の往復を毎回払わない（参照実装 image_cache の役目）
const imageCache = new Map<string, Promise<string | null>>();

export function imageSource(root: string, url: string): Promise<string | null> {
  if (/^(https?:|data:)/i.test(url)) return Promise.resolve(null); // 遠隔は描かない
  const cleaned = decodeURIComponent(url.replace(/^file:\/\//, ""));
  const key = `${root}\n${cleaned}`;
  let entry = imageCache.get(key);
  if (!entry) {
    entry = invoke<string>("image_read", { root, path: cleaned }).catch(
      () => null,
    );
    imageCache.set(key, entry);
  }
  return entry;
}
