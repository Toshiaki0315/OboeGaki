// ノート・フォルダ・雛形・ゴミ箱・タグ・やること・検索・リンク（Rust の note_* / folder_* / task_*）。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import type { NoteEntry } from "./note-order";

/// Rust の note_list が返す 1 件
export type NoteMeta = {
  path: string; // vault からの相対パス
  title: string;
  preview: string;
  mtime_ms: number;
  pinned: boolean;
};

type TrashMeta = { path: string; trashed_ms: number };

/// ゴミ箱の 1 件。**捨てた新しい順**で並んで届く（Rust 側が並べる）
export type TrashEntry = { path: string; trashedMs: number };

export type TagCount = { tag: string; count: number };

/// フォルダと**直下の**ノート件数。`folder` が空文字なら保管フォルダ直下。
export type FolderCount = { folder: string; count: number };

export function toEntry(root: string, meta: NoteMeta): NoteEntry {
  return {
    path: `${root}/${meta.path}`,
    label: meta.path.replace(/\.(md|markdown)$/i, ""),
    preview: meta.preview,
    mtimeMs: meta.mtime_ms,
    pinned: meta.pinned,
  };
}

/// 一覧の引き直しだけ（軽い）。索引の同期はしない — 同期は vault_open の
/// 背景スレッドと watcher が担い、終わると index-updated が飛んでくる
export async function fetchLists(root: string) {
  const metas = await invoke<NoteMeta[]>("note_list", { root });
  const notes: NoteEntry[] = metas.map((meta) => toEntry(root, meta));
  const tagPairs = await invoke<[string, number][]>("tag_list", { root });
  const tags: TagCount[] = tagPairs.map(([tag, count]) => ({ tag, count }));
  const folderPairs = await invoke<[string, number][]>("folder_list", { root });
  const folders: FolderCount[] = folderPairs.map(([folder, count]) => ({
    folder,
    count,
  }));
  const trashed = await invoke<TrashMeta[]>("trash_list", { root });
  const trashNotes: TrashEntry[] = trashed.map((entry) => ({
    path: entry.path,
    trashedMs: entry.trashed_ms,
  }));
  const tasks = await invoke<TaskRow[]>("task_list", { root });
  return { notes, tags, folders, trashNotes, tasks };
}

/// やること一覧の 1 行（ADR-0056）。path は vault からの相対
export type TaskRow = {
  path: string;
  line: number;
  text: string;
  due: string | null;
  mtime_ms: number;
};

/// 開いていないノートのやることを完了にする（開いているノートはエディタで書く）
/// `text` は一覧に出ていた文。Rust 側が行の文と突き合わせ、ずれていれば断る
/// （一覧の行番号は索引の写しなので、上に行が挟まると別のやることを指す。21-3）
export async function taskComplete(
  root: string,
  path: string,
  line: number,
  text: string,
): Promise<void> {
  await invoke("task_complete", { root, path, line, text });
}

/// レイアウト作成・監視開始・背景の索引同期を起動する。
/// `trashDays` は環境設定のゴミ箱の日数（省くと Rust 側の既定）
export async function openVaultRoot(
  root: string,
  trashDays?: number,
): Promise<void> {
  await invoke<void>("vault_open", { root, trashDays });
}

/// vault にノートが 1 つも無いか（ディスクを見る）。起動時に無題を作るか
/// の判断（lib/startup-note）
export async function vaultIsEmpty(root: string): Promise<boolean> {
  return invoke<boolean>("vault_is_empty", { root });
}

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

/// 新しいノートを作る。`folder`（vault からの相対）を渡すとその中に作る。
export async function createNote(
  root: string,
  title: string,
  folder?: string,
): Promise<string> {
  return invoke<string>("note_create", { root, title, folder });
}

/// 改名の結果。`rewritten` は `[[リンク]]` を書き換えた他のノートの数
/// （ADR-0053）、`failed` は書き換えられなかったノートの名前
export type RenameOutcome = {
  path: string;
  rewritten: number;
  failed: string[];
};

export async function renameNote(
  root: string,
  path: string,
  title: string,
): Promise<RenameOutcome> {
  return invoke<RenameOutcome>("note_rename", { root, path, title });
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
/// その日のノート。`day`（`YYYY-MM-DD`）を渡すとその日のぶん（7-5）。
export async function dailyNote(root: string, day?: string): Promise<NewNote> {
  return invoke<NewNote>("note_daily", { root, day });
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
/// フォルダを別のフォルダの中へ移す（空文字は直下）。移した先の相対パス
export async function moveFolder(
  root: string,
  folder: string,
  into: string,
): Promise<string> {
  return invoke<string>("folder_move", { root, folder, into });
}

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
export type Backlink = {
  path: string;
  title: string;
  context: string;
  /// 続柄（M-3）。付いていなければ空。
  relation: string;
};

export async function noteBacklinks(
  root: string,
  title: string,
): Promise<Backlink[]> {
  return invoke<Backlink[]>("note_backlinks", { root, title });
}

/// ノートを複製する。作った先の絶対パスが返る。
export async function duplicateNote(
  root: string,
  path: string,
): Promise<string> {
  return invoke<string>("note_duplicate", { root, path });
}

/// ノートを雛形として登録する。置いた場所が返る。
export async function registerTemplate(
  root: string,
  path: string,
  name: string,
): Promise<string> {
  return invoke<string>("template_register", { root, path, name });
}

/// 関連するノート（L-3）。**モデルは通さない**ので、Ollama が無くても出る。
export type RelatedNote = {
  /// vault からの相対パス
  path: string;
  title: string;
  /// 出た理由（そのまま画面に出す）
  reasons: string[];
};

export async function noteRelated(
  root: string,
  path: string,
  title: string,
): Promise<RelatedNote[]> {
  return invoke<RelatedNote[]>("note_related", { root, path, title });
}

/// リンクの図の素材（M-2）。`[指すノートの題名, 指し先, 続柄]`。
export async function linkMap(
  root: string,
): Promise<[string, string, string][]> {
  return invoke<[string, string, string][]>("link_map", { root });
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

/// 今日のノートの末尾に追記（どこからでも書き取り = ADR-0057）。置いた
/// ノートのパスを返す
export async function appendDaily(root: string, text: string): Promise<string> {
  return invoke<string>("note_append_daily", { root, text });
}

/// 既定の保管フォルダ（無ければ作る場所。ADR-0032）
export function defaultVault(): Promise<string> {
  return invoke<string>("default_vault", {});
}
