// ノート一覧の並び順（参照実装 C-3 / note_list_pane の役目）。

export type NoteEntry = {
  /// 絶対パス（開くときに使う）
  path: string;
  /// vault からの相対パス（拡張子なし）。フォルダ込みで表示する
  label: string;
  preview: string;
  mtimeMs: number;
  /// ピン留め（spec §7.3）。どの並び順でも先頭に固定する
  pinned: boolean;
};

export type SortOrder = "modified" | "title";

const byTitle = (a: NoteEntry, b: NoteEntry) =>
  a.label.localeCompare(b.label, "ja");

export function sortNotes(entries: NoteEntry[], order: SortOrder): NoteEntry[] {
  const sorted = [...entries];
  const byOrder =
    order === "title"
      ? byTitle
      : (a: NoteEntry, b: NoteEntry) => b.mtimeMs - a.mtimeMs || byTitle(a, b);
  // ピン留めが先。ピン同士・普通同士は選んだ並び順に従う
  sorted.sort((a, b) => Number(b.pinned) - Number(a.pinned) || byOrder(a, b));
  return sorted;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatStamp(mtimeMs: number): string {
  const date = new Date(mtimeMs);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
