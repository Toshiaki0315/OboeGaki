// 表の中の Enter / Tab（要望 2026-09-15）。
//
// 表はウィジェットのまま直せないので、カーソルが入ると生の記法に戻る
// （プレビューモードでも同じ。ADR-0065）。そこで**行と列を増やす手**が
// 要る — Enter で下に行を足し、Tab で次のセルへ（最後なら行を足す）。
// 列は行末で `|` を打つだけ（他の行は表を離れたときに `formatTable` が
// 空セルで埋める。ADR-0003 決定 4）。
//
// 判断は StateCommand（EditorState だけで動く）に閉じ込め、ヘッドレスで
// テストする。IME ガード（T5）はキーマップ側で `view.composing` を見る
// （input-assist と同じ作法）。

import {
  EditorSelection,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isDelimiterRow, rowPrefix } from "./table-format";

/// セルの中身の範囲（両端の空白は除く。空なら `| ` の直後で from === to）
type Cell = { from: number; to: number };

type TableRows = {
  /// 表の行（見出し・区切り・本体。文書の行番号）
  first: number;
  last: number;
  delimiter: number;
};

/// カーソルの行を含む表。無ければ null
function tableAt(state: EditorState, pos: number): TableRows | null {
  let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
    state,
  ).resolveInner(pos, -1);
  while (node && node.name !== "Table") node = node.parent;
  if (!node) return null;
  const first = state.doc.lineAt(node.from).number;
  // 表の終わりが行末の改行を含むことがあるので、1 つ戻す
  const endLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
  let delimiter = -1;
  for (let number = first; number <= endLine; number++) {
    if (isDelimiterRow(state.doc.line(number).text)) {
      delimiter = number;
      break;
    }
  }
  if (delimiter < 0) return null;
  return { first, last: endLine, delimiter };
}

/// 行の中のセル。`\|` は区切りにしない。先頭・末尾に縦棒が無い書き方も受ける
export function cellsOf(line: Line): Cell[] {
  const text = line.text;
  // 引用の頭（`> `）はセルではない。そこから先だけを見る
  const prefixLength = rowPrefix(text).length;
  const pipes: number[] = [];
  for (let index = prefixLength; index < text.length; index++) {
    if (text[index] === "|" && text[index - 1] !== "\\") pipes.push(index);
  }
  if (pipes.length === 0) return [];
  const start = prefixLength + text.slice(prefixLength).search(/\S/);
  const end = text.replace(/\s+$/, "").length;
  const bounds = [...pipes];
  if (pipes[0] !== start) bounds.unshift(start - 1);
  if (pipes[pipes.length - 1] !== end - 1) bounds.push(end);
  const cells: Cell[] = [];
  for (let index = 0; index + 1 < bounds.length; index++) {
    const rawFrom = bounds[index] + 1;
    const rawTo = bounds[index + 1];
    const segment = text.slice(rawFrom, rawTo);
    const lead = segment.length - segment.trimStart().length;
    const trail = segment.length - segment.trimEnd().length;
    let from = rawFrom + lead;
    let to = rawTo - trail;
    if (from > to) {
      // 空のセルは `| ` の直後に立つ
      from = to = rawFrom + Math.min(1, segment.length);
    }
    cells.push({ from: line.from + from, to: line.from + to });
  }
  return cells;
}

/// 新しい空の行（`|  |  |`）を after の下に足し、先頭のセルへ
function insertRowAfter(
  state: EditorState,
  after: Line,
  columns: number,
  dispatch: (tr: ReturnType<EditorState["update"]>) => void,
): boolean {
  const prefix = rowPrefix(after.text);
  const row = `${prefix}| ${Array.from({ length: columns }, () => "").join(" | ")} |`;
  const at = after.to;
  const caret = at + 1 + prefix.length + 2;
  dispatch(
    state.update({
      changes: { from: at, insert: `\n${row}` },
      selection: EditorSelection.cursor(caret),
      scrollIntoView: true,
    }),
  );
  return true;
}

/// Enter: 下に行を足す。見出しの行なら区切り行の下。**空の行で押したら表を
/// 抜ける**（箇条書きの Enter と同じ作法）
export const tableEnter: StateCommand = ({ state, dispatch }) => {
  // 選択があれば対象外（既定の置き換えに譲る。input-assist と同じ作法）
  if (!state.selection.main.empty) return false;
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return false;
  const line = state.doc.lineAt(head);
  const cells = cellsOf(line);
  if (cells.length === 0) return false;
  const isBody = line.number > table.delimiter;
  if (isBody && cells.every((cell) => cell.from === cell.to)) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "\n" },
        selection: EditorSelection.cursor(line.from + 1),
        scrollIntoView: true,
      }),
    );
    return true;
  }
  const after =
    line.number <= table.delimiter ? state.doc.line(table.delimiter) : line;
  return insertRowAfter(state, after, cells.length, dispatch);
};

/// 全部の行に空の列を 1 つ足し、見出しの新しいセルへ。**列は見出しが決める**
/// （GFM は見出しと区切りの列数が違うと表と見なさないので、見出しの行末に
/// `|` を打つだけでは表が壊れる）
function addColumn(
  state: EditorState,
  table: TableRows,
  dispatch: (tr: ReturnType<EditorState["update"]>) => void,
): boolean {
  const changes: { from: number; to: number; insert: string }[] = [];
  let caret = -1;
  for (let number = table.first; number <= table.last; number++) {
    const line = state.doc.line(number);
    const cells = cellsOf(line);
    if (cells.length === 0) continue;
    const texts = cells.map((cell) => state.sliceDoc(cell.from, cell.to));
    texts.push(number === table.delimiter ? "---" : "");
    const rebuilt = `${rowPrefix(line.text)}| ${texts.join(" | ")} |`;
    changes.push({ from: line.from, to: line.to, insert: rebuilt });
    if (number === table.first) {
      caret = line.from + rebuilt.length - 2; // 新しい見出しのセル（` |` の手前）
    }
  }
  if (caret < 0) return false;
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(caret),
      scrollIntoView: true,
    }),
  );
  return true;
}

/// Tab: 次のセルの末尾へ。**端まで来たら表を伸ばす** — 見出しの最後のセル
/// なら列を足し、最後の行の最後のセルなら行を足す。本体の行からは区切り行
/// を飛ばして次の行へ
export const tableNextCell: StateCommand = ({ state, dispatch }) => {
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return false;
  const line = state.doc.lineAt(head);
  const cells = cellsOf(line);
  if (cells.length === 0) return false;
  const index = cells.findIndex((cell) => head <= cell.to);
  const current = index < 0 ? cells.length - 1 : index;
  if (current + 1 < cells.length) {
    dispatch(
      state.update({
        selection: EditorSelection.cursor(cells[current + 1].to),
        scrollIntoView: true,
      }),
    );
    return true;
  }
  if (line.number < table.delimiter) {
    return addColumn(state, table, dispatch);
  }
  let next = line.number + 1;
  if (next === table.delimiter) next++;
  if (next > table.last) {
    return insertRowAfter(state, line, cells.length, dispatch);
  }
  const target = cellsOf(state.doc.line(next));
  if (target.length === 0) return false;
  dispatch(
    state.update({
      selection: EditorSelection.cursor(target[0].to),
      scrollIntoView: true,
    }),
  );
  return true;
};

/// Shift-Tab: 前のセルの末尾へ。先頭のセルなら上の行の最後のセル（区切り行は
/// 飛ばす）。見出しの先頭なら何もしない
export const tablePrevCell: StateCommand = ({ state, dispatch }) => {
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return false;
  const line = state.doc.lineAt(head);
  const cells = cellsOf(line);
  if (cells.length === 0) return false;
  const index = cells.findIndex((cell) => head <= cell.to);
  const current = index < 0 ? cells.length - 1 : index;
  if (current > 0) {
    dispatch(
      state.update({
        selection: EditorSelection.cursor(cells[current - 1].to),
        scrollIntoView: true,
      }),
    );
    return true;
  }
  let prev = line.number - 1;
  if (prev === table.delimiter) prev--;
  if (prev < table.first) return false;
  const target = cellsOf(state.doc.line(prev));
  if (target.length === 0) return false;
  dispatch(
    state.update({
      selection: EditorSelection.cursor(target[target.length - 1].to),
      scrollIntoView: true,
    }),
  );
  return true;
};

/// 表の中だけで効く鍵。inputAssist より**先**に置く（表の中の Tab は字下げ
/// ではなくセル移動）。補完の Tab は更に先
export const tableKeys = keymap.of([
  { key: "Enter", run: (view) => !view.composing && tableEnter(view) },
  { key: "Tab", run: (view) => !view.composing && tableNextCell(view) },
  { key: "Shift-Tab", run: (view) => !view.composing && tablePrevCell(view) },
]);
