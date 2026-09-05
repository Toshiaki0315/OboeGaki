// 見出し単位の折りたたみ（TASKS 2-4、ADR-0019 の CM6 版)。
//
// 参照実装は QTextBlock.setVisible を自前で面倒見たが、CM6 は foldService に
// 「畳める範囲」を返すだけで、開閉 UI（ガター）・隠れた行の飛び越え・
// 置換ウィジェットまで標準機構が持つ。状態はセッション限り（ノートを
// 開き直せば全部開く — EditorView がノートごとに作り直されるため）。

import type { EditorState } from "@codemirror/state";
import {
  ensureSyntaxTree,
  foldGutter,
  foldService,
  syntaxTree,
} from "@codemirror/language";

const HEADING_RE = /^ATXHeading(\d)$/;

/// 木の解析を待つ上限。畳む印はガターを描くたびに要るので短くする
/// （spec §6.6 の 16ms を壊さない。間に合わなければ印を出さないだけ）。
const PARSE_WAIT_MS = 50;

/// 見出し行が畳む範囲（見出しの行末から、同じか浅い次の見出しの手前まで）。
/// 見出しでない・中身が無いときは null。
export function headingSection(
  state: EditorState,
  lineStart: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  // **木を待つ。** `syntaxTree` は時間で打ち切られるので、長いノートでは
  // 見出しに届かないまま返り、畳む印が消える
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_WAIT_MS) ??
    syntaxTree(state);
  // 行頭の見出しノードを取る。resolve だと Document に丸められることが
  // あるので、行頭位置を含む最小ノードから親へ辿る
  let heading = tree.resolveInner(line.from, 1);
  while (heading.parent && !HEADING_RE.test(heading.name)) {
    heading = heading.parent;
  }
  const found = HEADING_RE.exec(heading.name);
  if (!found || heading.from !== line.from) return null;
  const level = Number(found[1]);

  // 次の「同じか浅い」見出しまで、トップレベルの兄弟だけを辿る。
  // tree.iterate は enter で false を返しても走査自体は止まらないため、
  // 文書末まで舐めてしまい打鍵のたびに O(文書長) かかる（実測で
  // p95 26.5ms → 基準割れ）。兄弟歩きなら節の長さで止まる
  let end = state.doc.length;
  let stopped = false;
  for (let node = heading.node.nextSibling; node; node = node.nextSibling) {
    const next = HEADING_RE.exec(node.name);
    if (next && Number(next[1]) <= level) {
      end = state.doc.lineAt(node.from).from - 1; // 前の行の行末
      stopped = true;
      break;
    }
  }
  // 木が文書の終わりまで届いていないなら、この先に見出しがあるかは
  // 分からない。**畳まない** — 次の節まで飲み込むほうが害が大きい
  if (!stopped && tree.length < state.doc.length) return null;
  if (end <= line.to) return null; // 中身が無い
  return { from: line.to, to: end };
}

export const headingFolding = [
  foldService.of((state, lineStart) => headingSection(state, lineStart)),
  foldGutter({
    openText: "▾",
    closedText: "▸",
  }),
];
