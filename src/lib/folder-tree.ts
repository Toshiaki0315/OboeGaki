// フォルダの木の並べ方（ADR-0024）。
//
// **「直下」は行ではなく見出し**（要望 2026-09-05）。見出しの「フォルダ」が
// 保管フォルダそのものを指し、件数も他の行と同じ形で右端に出す。同じ場所を
// 指す行が 2 つ並んでいると、どちらを押せばよいのか分からない。

import { TRASH_FOLDER } from "./finder";

export type FolderCount = { folder: string; count: number };

/// 見出しに出す件数（直下のノートの数）と、木に並べる中のフォルダ。
export function splitFolders<T extends FolderCount>(
  folders: readonly T[],
): { root: number; sub: T[] } {
  const root = folders.find((entry) => entry.folder === "");
  return {
    root: root?.count ?? 0,
    sub: folders.filter((entry) => entry.folder !== ""),
  };
}

/// フォルダ行の見出し。直下（空文字）だけ名前を付け、あとは末端の名前。
export function folderLabel(folder: string): string {
  if (!folder) return "直下";
  return folder.split("/").pop() ?? folder;
}

/// 階層の深さ（直下は 0）。ツリーの字下げに使う。
export function folderDepth(folder: string): number {
  return folder ? folder.split("/").length : 0;
}

/// 新しいノートを置くフォルダ（要望 2026-09-07）。**絞っているフォルダの中に
/// 作る** — 一覧に出ないところへ作ると、作ったのに見えない。絞っていない・
/// 直下・ゴミ箱のときは直下（ゴミ箱の中には作らない）。
export function newNoteFolder(folderFilter: string | null): string {
  if (folderFilter === null || folderFilter === TRASH_FOLDER) return "";
  return folderFilter;
}

/// そのフォルダの中に別のフォルダがあるか（子でも孫でも）。区切りで見る —
/// 「仕事」の中に「仕事場」を数えない。
export function hasSubfolders(
  folder: string,
  folders: readonly FolderCount[],
): boolean {
  const prefix = `${folder}/`;
  return folders.some((entry) => entry.folder.startsWith(prefix));
}

/// 右端に出す件数（要望 2026-09-08）。**数字は直下だけ**（ADR-0024 追記 4:
/// 選んだときの一覧と一致させる）を保ちつつ、直下が 0 で中のフォルダに
/// ノートがあるときだけ、その合計を括弧で出す — 素の 0 は「何も無い」に
/// 見える。括弧は「選んでも一覧には出ない数」の印。
export function folderCount(
  folder: string,
  count: number,
  folders: readonly FolderCount[],
): { text: string; inner: boolean } {
  if (count > 0) return { text: String(count), inner: false };
  const prefix = folder ? `${folder}/` : "";
  const inner = folders
    .filter((entry) => entry.folder !== "" && entry.folder.startsWith(prefix))
    .reduce((sum, entry) => sum + entry.count, 0);
  if (inner === 0) return { text: "0", inner: false };
  return { text: `(${inner})`, inner: true };
}

/// 畳んだフォルダの中身を隠した一覧（要望 2026-09-08）。畳んだフォルダ
/// そのものは残す（開き直す三角がそこにある）。
export function visibleFolders<T extends FolderCount>(
  folders: readonly T[],
  collapsed: ReadonlySet<string>,
): T[] {
  return folders.filter((entry) => {
    for (const shut of collapsed) {
      if (entry.folder.startsWith(`${shut}/`)) return false;
    }
    return true;
  });
}
