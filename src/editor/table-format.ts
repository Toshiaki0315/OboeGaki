// 表のソース整形と挿入（TASKS 2-6、参照実装 core/table.py の移植）。
//
// 整形は「エディタで表を離れたとき」に走る（ADR-0003 決定 4）。
// 列数が足りない行は空セルで埋め、多い行は捨てずに残す —
// 書いた内容を失わないほうを優先する。
//
// **桁は揃えない**（ADR-0044）。空白を詰めて縦線を揃えるには「全角:半角 =
// 2:1 の等幅フォントで表示される」ことが前提になるが、本文のフォントは
// 設定で変えられるし、既定のプロポーショナルでは揃わない。揃わない前提で
// 空白を詰めても、ソースが長くなって差分が読みにくくなるだけ。

import type { EditorState } from "@codemirror/state";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Replacement } from "./format-commands";

const ESCAPED_PIPE = "\\|";
const PREFIX_RE = /^(?:[ \t]*>[ \t]?)*[ \t]*/;
const DELIMITER_CELL_RE = /^:?-+:?$/;

type Alignment = "left" | "right" | "center" | "none";

/// 区切り行のセル。**幅を持たせない** — 揃えないので 3 文字で足りる
/// （`---` は Markdown の書き手にいちばん見慣れた形）。
const DELIMITER_CELLS: Record<Alignment, string> = {
  left: ":--",
  right: "--:",
  center: ":-:",
  none: "---",
};

/// 行の中身をセルに割る。`\|` は区切りにしない（GFM のリテラルなパイプ）。
export function splitCells(body: string): string[] {
  const cells: string[] = [];
  let current = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      current += ESCAPED_PIPE;
      index += 2;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
    index++;
  }
  cells.push(current);
  return cells;
}

type Row = { prefix: string; cells: string[] };

function splitRow(line: string): Row {
  const prefix = PREFIX_RE.exec(line)?.[0] ?? "";
  let body = line.slice(prefix.length).trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith(ESCAPED_PIPE)) {
    body = body.slice(0, -1);
  }
  return { prefix, cells: splitCells(body).map((cell) => cell.trim()) };
}

function isDelimiter(line: string): boolean {
  const row = splitRow(line);
  return (
    row.cells.length > 0 &&
    row.cells.every((cell) => DELIMITER_CELL_RE.test(cell))
  );
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/// 表のソースを整える（区切りと列数だけ。**桁は揃えない**）。表でなければ null。
export function formatTable(lines: readonly string[]): string[] | null {
  if (lines.length < 2) return null;
  const delimiterIndex = lines.findIndex(isDelimiter);
  if (delimiterIndex <= 0) return null;

  const rows = lines.map(splitRow);
  const columns = Math.max(...rows.map((row) => row.cells.length));
  const alignments = rows[delimiterIndex].cells.map(alignmentOf);
  while (alignments.length < columns) alignments.push("none");

  return rows.map((row, index) => {
    let cells: string[];
    if (index === delimiterIndex) {
      cells = alignments.map((alignment) => DELIMITER_CELLS[alignment]);
    } else {
      cells = [...row.cells];
      // 足りない列は空セルで埋める（多い行はそのまま残す）
      while (cells.length < columns) cells.push("");
    }
    return `${row.prefix}| ` + cells.join(" | ") + " |";
  });
}

export const HEADER_PLACEHOLDER = "見出し";

/// 空の表を作る。`rows` は見出しを除いた本体の行数。整形済みで返すので、
/// 作った直後に表を離れてもソースは動かない。
export function newTable(rows: number, columns: number): string[] {
  const bodyRows = Math.max(1, rows);
  const bodyColumns = Math.max(1, columns);
  const header = Array.from(
    { length: bodyColumns },
    (_, i) => `${HEADER_PLACEHOLDER}${i + 1}`,
  );
  const lines = [
    "| " + header.join(" | ") + " |",
    "| " + Array(bodyColumns).fill("---").join(" | ") + " |",
    ...Array(bodyRows).fill(
      "| " + Array(bodyColumns).fill("").join(" | ") + " |",
    ),
  ];
  return formatTable(lines) ?? lines;
}

/// キャレットの位置に空の表を差し込む（参照実装 insert_table）。
/// 表はブロックなので行頭から始め、選択していた文字は消さない。
export function insertTableAt(
  text: string,
  start: number,
  end: number,
  size: { rows: number; columns: number },
): Replacement {
  const caret = Math.max(start, end);
  const head = text.slice(0, caret);
  const lines = newTable(size.rows, size.columns);
  const before =
    !head || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
  const body = before + lines.join("\n") + "\n\n";
  const label = `${HEADER_PLACEHOLDER}1`;
  const selectStart = caret + before.length + lines[0].indexOf(label);
  return {
    start: caret,
    end: caret,
    text: body,
    selectStart,
    selectEnd: selectStart + label.length,
  };
}

/// 表の範囲をまとめて置き換える変更を作る。既に揃っていれば null。
export function formatTableChange(
  state: EditorState,
  zone: { from: number; to: number },
): { from: number; to: number; insert: string } | null {
  const first = state.doc.lineAt(zone.from);
  const last = state.doc.lineAt(Math.min(zone.to, state.doc.length));
  const lines: string[] = [];
  for (let n = first.number; n <= last.number; n++) {
    lines.push(state.doc.line(n).text);
  }
  const formatted = formatTable(lines);
  if (!formatted) return null;
  const insert = formatted.join("\n");
  const current = state.sliceDoc(first.from, last.to);
  if (insert === current) return null;
  return { from: first.from, to: last.to, insert };
}

function tableAt(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const bounded = Math.max(0, Math.min(pos, state.doc.length));
  for (const side of [1, -1] as const) {
    let node = syntaxTree(state).resolveInner(bounded, side);
    while (node.parent && node.name !== "Table") node = node.parent;
    if (node.name === "Table") return { from: node.from, to: node.to };
  }
  return null;
}

/// キャレットが表を離れたら、そのソースを整える（ADR-0003 決定 4 / ADR-0044）。
export const tableAutoFormat = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.selectionSet && !update.docChanged) return;
      if (this.view.composing) return; // IME 中は触らない（T5）
      const oldHead = update.startState.selection.main.head;
      const oldTable = tableAt(update.startState, oldHead);
      if (!oldTable) return;
      // 編集ごと動いたときは位置を新文書へ写してから見直す
      const mappedFrom = update.docChanged
        ? update.changes.mapPos(oldTable.from, 1)
        : oldTable.from;
      const table = tableAt(update.state, mappedFrom);
      if (!table) return; // 表でなくなった（壊した）なら触らない
      const newHead = update.state.selection.main.head;
      if (newHead >= table.from && newHead <= table.to) return; // まだ中
      const change = formatTableChange(update.state, table);
      if (!change) return;
      const expected = update.state;
      // update 処理の中では dispatch できないので次のタスクで置き換える
      queueMicrotask(() => {
        if (this.view.state !== expected) return; // もう別の状態（打ち消す）
        this.view.dispatch({
          changes: change,
          userEvent: "format.table",
          // Undo を 1 段消費させない（レビュー 2026-09-04: 表を離れる
          // たびに「整形の取り消し」が履歴に積まれ、Cmd+Z の 1 回目が
          // 直前の入力に戻らなくなっていた）
          annotations: Transaction.addToHistory.of(false),
        });
      });
    }
  },
);
