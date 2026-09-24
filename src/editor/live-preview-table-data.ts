// 表 widget に渡すデータの抽出（ADR-0035）。純関数で、書き出し側とも共有できる形。
// 19-2 で live-preview.ts から分けた

import { type EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/// 表 widget に渡すデータ（ADR-0035）。抽出は純関数で行いテストする。
/// セルは「記号を落とした断片の並び」（ADR-0031 の Fragment 相当）。
/// 入れ子は種類の集合（kinds）で持つ。
import { tableAlign, type TableAlign } from "../markdown/table-align";
export type { TableAlign };
export type CellSegment = { text: string; kinds: string[] };
export type TableData = {
  header: CellSegment[][];
  aligns: TableAlign[];
  rows: CellSegment[][][];
};

// セル内で描き分ける種類（ADR-0031）。リンク・画像は対象外 —
// 記号だけ消すと URL が見えなくなるので生のまま見せる
const CELL_KINDS: Record<string, string> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
  Strikethrough: "strike",
  Highlight: "highlight",
  Hashtag: "tag",
};
const CELL_RAW = new Set(["Link", "Image", "Autolink", "WikiLink"]);
// セル内の強制改行（ADR-0028）。`<br>` `<br/>` `<BR />` を同義に扱う。
// 意味を持つのは表のセルの中だけ — 本文の <br> は文字のまま
const FORCED_BREAK_RE = /^<br\s*\/?>$/i;

const CELL_MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "HighlightMark",
]);

/// セルの中身を、マーカーを落とした断片の並びにする。
function cellSegments(state: EditorState, cell: SyntaxNode): CellSegment[] {
  const out: CellSegment[] = [];
  const emit = (from: number, to: number, kinds: string[]) => {
    if (from >= to) return;
    const text = state.sliceDoc(from, to);
    const last = out[out.length - 1];
    if (last && last.kinds.join("\u0000") === kinds.join("\u0000")) {
      last.text += text;
    } else {
      out.push({ text, kinds });
    }
  };
  const walk = (node: SyntaxNode, kinds: string[]) => {
    let pos = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      emit(pos, child.from, kinds);
      pos = child.to;
      if (CELL_MARKS.has(child.name)) continue; // マーカーは描かない
      if (CELL_RAW.has(child.name)) {
        emit(child.from, child.to, kinds); // 生のまま
        continue;
      }
      if (
        child.name === "HTMLTag" &&
        FORCED_BREAK_RE.test(state.sliceDoc(child.from, child.to))
      ) {
        out.push({ text: "\n", kinds: ["br"] }); // セル内の改行（ADR-0028）
        continue;
      }
      const kind = CELL_KINDS[child.name];
      if (kind === "tag") {
        emit(child.from, child.to, [...kinds, kind]); // タグは # ごと
        continue;
      }
      walk(child, kind ? [...kinds, kind] : kinds);
    }
    emit(pos, node.to, kinds);
  };
  walk(cell, []);
  // セルの端の空白を落とす
  if (out.length > 0) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((segment) => segment.text.length > 0);
}

/// Table ノードからセルの中身を取り出す（EditorState だけで動く）。
export function tableData(state: EditorState, table: SyntaxNode): TableData {
  // **セルは区切りの位置で数える。** Lezer の Table は中身の無いセルに
  // TableCell ノードを作らないので、ノードだけ拾うと空セルが消えて後ろの
  // セルが 1 つ左へずれる（実機 2026-09-10）。区切りで割った範囲に
  // ノードが乗っていればその中身、乗っていなければ空セル
  const cellsOf = (row: SyntaxNode): CellSegment[][] => {
    const nodes = row.getChildren("TableCell");
    const text = state.sliceDoc(row.from, row.to);
    let start = text.length - text.trimStart().length;
    let end = text.trimEnd().length;
    const bars: number[] = [];
    for (let i = start; i < end; i++) {
      if (text[i] === "\\") {
        i++; // `\|` は区切りにしない（GFM）
        continue;
      }
      if (text[i] === "|") bars.push(i);
    }
    // 行頭・行末のパイプは外側の縁（セルの区切りではない）
    if (bars[0] === start) {
      start++;
      bars.shift();
    }
    if (bars[bars.length - 1] === end - 1) {
      end--;
      bars.pop();
    }
    const edges = [start, ...bars.map((bar) => bar + 1)];
    return edges.map((from, index) => {
      const to = index < bars.length ? bars[index] : end;
      const node = nodes.find(
        (cell) => cell.from >= row.from + from && cell.to <= row.from + to,
      );
      return node ? cellSegments(state, node) : [];
    });
  };
  const header = table.getChild("TableHeader");
  const delimiter = table.getChild("TableDelimiter");
  const aligns = delimiter
    ? state
        .sliceDoc(delimiter.from, delimiter.to)
        .replace(/^\||\|$/g, "")
        .split("|")
        .map(tableAlign)
    : [];
  return {
    header: header ? cellsOf(header) : [],
    aligns,
    rows: table.getChildren("TableRow").map(cellsOf),
  };
}
