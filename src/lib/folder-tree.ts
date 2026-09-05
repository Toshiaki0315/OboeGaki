// フォルダの木の並べ方（ADR-0024）。
//
// **「直下」は行ではなく見出し**（要望 2026-09-05）。見出しの「フォルダ」が
// 保管フォルダそのものを指し、件数も他の行と同じ形で右端に出す。同じ場所を
// 指す行が 2 つ並んでいると、どちらを押せばよいのか分からない。

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
