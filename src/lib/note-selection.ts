// ノート一覧の複数選択と、まとめて掴む（要望 2026-09-10）。
//
// 選択は「開いているノート」とは別の集合。ふつうのクリックは開く（選択は
// その 1 件になる）、Cmd+クリックで足し外し、Shift+クリックで開いている
// ノートから押した行までの範囲。掴んだ行が選択に入っていれば選択の全部を
// 動かし、入っていなければその行だけ（Finder と同じ読み方）。

import { canDropInto } from "./note-drop";

export function toggleSelection(
  selected: ReadonlySet<string>,
  path: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/// 起点（開いているノート）から押した行まで、一覧の並びで選ぶ。
/// 起点が無い・一覧に無ければ押した行だけ
export function rangeSelection(
  order: readonly string[],
  anchor: string | null,
  path: string,
): Set<string> {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(path);
  if (from < 0 || to < 0) return new Set([path]);
  const [low, high] = from <= to ? [from, to] : [to, from];
  return new Set(order.slice(low, high + 1));
}

/// 掴んだときに動かす対象。一覧の並びで返し、一覧に無いもの（絞り込みで
/// 隠れた・消えた）は落とす
export function draggedNotes(
  order: readonly string[],
  selected: ReadonlySet<string>,
  grabbed: string,
): string[] {
  if (!selected.has(grabbed)) return [grabbed];
  const picked = order.filter((path) => selected.has(path));
  return picked.length > 0 ? picked : [grabbed];
}

/// dataTransfer に載せる形。パスに改行は入らないので改行で繋ぐ
export function encodeNoteDrag(paths: readonly string[]): string {
  return paths.join("\n");
}

export function parseNoteDrag(data: string): string[] {
  return data.split("\n").filter((line) => line.length > 0);
}

/// 1 つでも別のフォルダから来るなら受ける（同じ場所へは動かない）
export function canDropAny(
  root: string,
  paths: readonly string[],
  folder: string,
): boolean {
  return paths.some((path) => canDropInto(root, path, folder));
}
