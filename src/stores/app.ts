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
  pinned: boolean;
};

export type TagCount = { tag: string; count: number };
/// フォルダと**直下の**ノート件数。`folder` が空文字なら保管フォルダ直下。
export type FolderCount = { folder: string; count: number };

type AppState = {
  vaultRoot: string | null;
  notes: NoteEntry[];
  tags: TagCount[];
  folders: FolderCount[];
  trashNotes: string[];
  currentPath: string | null;
  /// `trashDays` は環境設定のゴミ箱の日数（省くと Rust 側の既定）
  openVault: (root: string, trashDays?: number) => Promise<void>;
  refresh: () => Promise<void>;
  selectNote: (path: string | null) => void;
};

function toEntry(root: string, meta: NoteMeta): NoteEntry {
  return {
    path: `${root}/${meta.path}`,
    label: meta.path.replace(/\.(md|markdown)$/i, ""),
    preview: meta.preview,
    mtimeMs: meta.mtime_ms,
    pinned: meta.pinned,
  };
}

// 一覧の引き直しだけ（軽い）。索引の同期はしない — 同期は vault_open の
// 背景スレッドと watcher が担い、終わると index-updated が飛んでくる
async function fetchLists(root: string) {
  const metas = await invoke<NoteMeta[]>("note_list", { root });
  const notes: NoteEntry[] = metas.map((meta) => toEntry(root, meta));
  const tagPairs = await invoke<[string, number][]>("tag_list", { root });
  const tags: TagCount[] = tagPairs.map(([tag, count]) => ({ tag, count }));
  const folderPairs = await invoke<[string, number][]>("folder_list", { root });
  const folders: FolderCount[] = folderPairs.map(([folder, count]) => ({
    folder,
    count,
  }));
  const trashNotes = await invoke<string[]>("trash_list", { root });
  return { notes, tags, folders, trashNotes };
}

export const useAppStore = create<AppState>((set, get) => ({
  vaultRoot: null,
  notes: [],
  tags: [],
  folders: [],
  trashNotes: [],
  currentPath: null,

  async openVault(root, trashDays) {
    // レイアウト作成・監視開始・背景の索引同期を起動してから一覧を引く
    await invoke<string[]>("vault_open", { root, trashDays });
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

/// そのノートが今もあるか。改名・ゴミ箱移動の途中でも「消えた」は届くので、
/// **本当に無いときだけ**聞くために確かめる（spec §7.5）。
export async function noteExists(root: string, path: string): Promise<boolean> {
  return invoke<boolean>("note_exists", { root, path });
}

export async function readNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_read", { root, path });
}

export async function writeNote(
  root: string,
  path: string,
  text: string,
  historyMinutes?: number,
): Promise<void> {
  await invoke("note_write", { root, path, text, historyMinutes });
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

/// ピン留めの付け外し。書き換え後の本文が返る（エディタが差し替える）。
export async function pinNote(
  root: string,
  path: string,
  pinned: boolean,
): Promise<string> {
  return invoke<string>("note_pin", { root, path, pinned });
}

/// ゴミ箱の 1 件を完全に消す。消してよいかの確認は呼び出し側の仕事。
export async function deleteForever(root: string, path: string): Promise<void> {
  await invoke("trash_delete", { root, path });
}

/// ゴミ箱を空にする。確認は呼び出し側の仕事。
export async function emptyTrash(root: string): Promise<void> {
  await invoke("trash_empty", { root });
}

/// そのタグ（と配下のタグ）が付いたノートだけ。サイドバーのタグクリックは
/// 全文検索ではなくこれで絞る（C-4。`#work` の検索が「#workshop」と
/// 書いただけのノートまで拾うのを避ける）。
export async function notesWithTag(
  root: string,
  tag: string,
): Promise<NoteEntry[]> {
  const metas = await invoke<NoteMeta[]>("notes_with_tag", { root, tag });
  return metas.map((meta) => toEntry(root, meta));
}

/// 作ったばかりのノート。cursor は `{{cursor}}` があった位置
/// （UTF-16 コード単位 = CM6 のオフセット）。
export type NewNote = { path: string; cursor: number | null };

/// `templates/` にある雛形（絶対パス。名前順）。
export async function templateList(root: string): Promise<string[]> {
  return invoke<string[]>("template_list", { root });
}

/// 雛形から新しいノートを作る（E-4）。題名は雛形の名前になる。
export async function createFromTemplate(
  root: string,
  template: string,
): Promise<NewNote> {
  return invoke<NewNote>("note_create_from_template", {
    root,
    template,
    title: "",
  });
}

/// 今日のノート。無ければ日次の雛形から作る（E-4）。
export async function dailyNote(root: string): Promise<NewNote> {
  return invoke<NewNote>("note_daily", { root });
}

/// 使い方のノートを今の内容で置き直す。置いた場所を返す。
export async function placeManual(root: string): Promise<string> {
  return invoke<string>("manual_place", { root });
}

/// そのフォルダ**直下**のノート（ADR-0024 追記 4。子孫は含めない）。
export async function notesInFolder(
  root: string,
  folder: string,
): Promise<NoteEntry[]> {
  const metas = await invoke<NoteMeta[]>("notes_in_folder", { root, folder });
  return metas.map((meta) => toEntry(root, meta));
}

export async function createFolder(
  root: string,
  folder: string,
): Promise<string> {
  return invoke<string>("folder_create", { root, folder });
}

/// フォルダの名前を変える。新しい相対パスが返る。
export async function renameFolder(
  root: string,
  folder: string,
  name: string,
): Promise<string> {
  return invoke<string>("folder_rename", { root, folder, name });
}

/// フォルダを消す。ノートが入っていると Rust 側が断る。
export async function deleteFolder(
  root: string,
  folder: string,
): Promise<void> {
  await invoke("folder_delete", { root, folder });
}

/// ノートをフォルダへ移す。移した先の絶対パスが返る。
export async function moveNote(
  root: string,
  path: string,
  folder: string,
): Promise<string> {
  return invoke<string>("note_move", { root, path, folder });
}

/// このノートを `[[…]]` で指しているノート（E-6）。
/// `context` は指している**行そのもの**。
export type Backlink = { path: string; title: string; context: string };

export async function noteBacklinks(
  root: string,
  title: string,
): Promise<Backlink[]> {
  return invoke<Backlink[]>("note_backlinks", { root, title });
}

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

/// 走査の結果（M-6）。「何も起きなかった」と「壊れている」を分けるために
/// 何件動いたかを返す。
export type SyncResult = { added: number; updated: number; removed: number };

/// ファイルと索引を手で合わせ直す。始めたら true、走査中なら false。
/// 終わりは "index-synced" イベントで届く。
export async function syncIndex(root: string, full: boolean): Promise<boolean> {
  return invoke<boolean>("index_sync", { root, full });
}

export type SearchHit = {
  /** vault からの相対パス */
  path: string;
  title: string;
  snippet: string;
};

/// 検索の結果。`unreadable` は日付として読めなかった `after:` / `before:`
/// （探すのはやめないが、書き方が違うことは画面に出す）。
export type SearchOutcome = { hits: SearchHit[]; unreadable: string[] };

export async function searchNotes(
  root: string,
  query: string,
): Promise<SearchOutcome> {
  return invoke<SearchOutcome>("note_search", { root, query });
}

/// 貼り付け・ドロップの画像を attachments/ へ保存し、本文へ挿す
/// Markdown（`![](attachments/…)`）を返す。
export async function saveAttachment(
  root: string,
  data: Uint8Array,
  name: string,
): Promise<string> {
  // Tauri の JSON 経路で運ぶため base64 にする（チャンクで組んで
  // スタック溢れを避ける — spread で一気に渡すと大きい画像で落ちる）
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return invoke<string>("attachment_save", {
    root,
    data: btoa(binary),
    suffix: name,
  });
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
