// プレーンテキストコピー（TASKS 2-8、spec §5.4 の Cmd+Shift+C）。
//
// 参照実装 core/document.plain_text と同じ判断: 装飾は文章の一部ではない。
// マーカー（行頭の # > リスト記号と、インラインの開き / 閉じ記号）を
// 外した写しを作る。コードはフェンスの記号ごと残す — 記号ごと貼れた
// ほうがよい。ソース文字列そのものは一切変えない（T1）。

import type { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// 落とすマーカーのノード名。URL は残す（リンク先も文章の一部）
const MARK_NODES = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "LinkMark",
  "WikiLinkMark",
]);
// 行頭マーカー: 後続の空白 1 つも一緒に落とす
const LINE_MARK_NODES = new Set(["HeaderMark", "QuoteMark", "ListMark"]);

/// `[from, to)` のマーカーを外した写しを返す。
export function plainTextOf(
  state: EditorState,
  from: number,
  to: number,
): string {
  const drops: [number, number][] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        return false; // コードは記号ごと残す
      }
      if (MARK_NODES.has(node.name)) {
        drops.push([node.from, node.to]);
      } else if (LINE_MARK_NODES.has(node.name)) {
        const next = state.sliceDoc(node.to, node.to + 1);
        drops.push([node.from, next === " " ? node.to + 1 : node.to]);
      }
    },
  });
  drops.sort((a, b) => a[0] - b[0]);
  let text = "";
  let pos = from;
  for (const [dropFrom, dropTo] of drops) {
    if (dropTo <= pos) continue;
    if (dropFrom > pos) text += state.sliceDoc(pos, Math.min(dropFrom, to));
    pos = Math.max(pos, Math.min(dropTo, to));
  }
  if (pos < to) text += state.sliceDoc(pos, to);
  return text;
}

/// 選択（無ければ文書全体）をプレーンテキストとしてクリップボードへ。
export const copyPlainText = (view: EditorView): boolean => {
  const { from, to } = view.state.selection.main;
  const [start, end] = from === to ? [0, view.state.doc.length] : [from, to];
  const text = plainTextOf(view.state, start, end);
  void navigator.clipboard?.writeText(text).catch(() => {
    // クリップボードに書けない環境では黙って何もしない
  });
  return true;
};

export const plainCopyKeymap = keymap.of([
  { key: "Mod-Shift-c", run: copyPlainText },
]);
