// 見出し単位の折りたたみ（TASKS 2-4、ADR-0019 の CM6 版)。
//
// 参照実装は QTextBlock.setVisible を自前で面倒見たが、CM6 は foldService に
// 「畳める範囲」を返すだけで、開閉 UI（ガター）・隠れた行の飛び越え・
// 置換ウィジェットまで標準機構が持つ。状態はセッション限り（ノートを
// 開き直せば全部開く — EditorView がノートごとに作り直されるため）。

import type { EditorState, Text } from "@codemirror/state";
import { foldGutter, foldService } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { treeOf } from "./parse-tree";

import { detailsSection } from "./details-container";
import { colonContainers, DETAILS_OPEN_RE } from "../markdown/containers";
import { codeLineTest } from "./code-lines";

import { HEADING_NODE_RE as HEADING_RE } from "./outline";

/// 見出し行が畳む範囲（見出しの行末から、同じか浅い次の見出しの手前まで）。
/// 見出しでない・中身が無いときは null。
export function headingSection(
  state: EditorState,
  lineStart: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  // **木を待つ。** `syntaxTree` は時間で打ち切られるので、長いノートでは
  // 見出しに届かないまま返り、畳む印が消える
  const tree = treeOf(state);
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

/// その位置がフェンスやインデントのコードの中か。畳む候補の行でだけ訊くので、
/// 木を上へ辿るだけで足りる
function insideCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = treeOf(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

/// 画面が囲みと認めた `:::details` の開きの行（0 始まり）。`:::note` や寄せの中の
/// `:::details` は入れ子になるので囲みにならず、字のまま見える（ADR-0069 の
/// 決定 3）。開きの行から閉じを探すだけでは分からないので、画面と同じ 1 本の走査で
/// 見る。折りたたみは見えている行ごとに訊かれるので、**文書ごとに 1 回だけ**数える
const detailsOpens = new WeakMap<Text, Set<number>>();

function detailsOpensOf(state: EditorState): Set<number> {
  let found = detailsOpens.get(state.doc);
  if (!found) {
    found = new Set(
      colonContainers(state.doc.iterLines(), codeLineTest(state))
        .filter((entry) => entry.kind === "details")
        .map((entry) => entry.open),
    );
    detailsOpens.set(state.doc, found);
  }
  return found;
}

export const headingFolding = [
  foldService.of((state, lineStart) => headingSection(state, lineStart)),
  // 折りたたみの囲み（6-2）。行の並びで決まるが、コードの中の開きと閉じは
  // 数えない（コード例の `:::details` を畳めてしまっていた。22-1）。入れ子で
  // 字のまま見える `:::details` も畳まない（レビュー 2026-09-29）
  foldService.of((state, lineStart) => {
    const line = state.doc.lineAt(lineStart);
    if (
      line.from === lineStart &&
      DETAILS_OPEN_RE.test(line.text) &&
      !detailsOpensOf(state).has(line.number - 1)
    ) {
      return null;
    }
    return detailsSection(state.doc, lineStart, (pos) =>
      insideCode(state, pos),
    );
  }),
  foldGutter({
    openText: "▾",
    closedText: "▸",
  }),
];
