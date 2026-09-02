// ライブプレビューの中核: マーカーを Decoration.replace で隠し、
// カーソルが親ノードに触れている間だけソースを見せる。スパイク #2 の移植。
//
// 文書テキストは一切変更しないので、ソースが唯一の真実（hitofude R1）と
// 位置の 1:1 対応（R4）は構造的に保たれ、装飾は Undo スタックに乗らない（R5）。

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightTag } from "./extended-inline";

// 隠す対象のマーカーノード（§6.4 のリビール表のインライン分）。
// URL はマーカーではないが「`(url)` 部分を隠す」規則なのでここに含める
const MARK_NODES = new Set([
  "EmphasisMark",
  "HeaderMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "LinkMark",
  "URL",
]);

function touchesSelection(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const hideMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (!MARK_NODES.has(node.name)) return;
            // 親（Emphasis / ATXHeading1 など）にカーソルが触れている間は
            // ソースを見せる
            const parent = node.node.parent;
            if (parent && touchesSelection(view.state, parent.from, parent.to))
              return;
            // HeaderMark は直後の空白も一緒に隠す（`# ` の 2 文字）
            let end = node.to;
            if (
              node.name === "HeaderMark" &&
              view.state.sliceDoc(end, end + 1) === " "
            ) {
              end += 1;
            }
            builder.add(node.from, end, Decoration.replace({}));
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const style = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.6em" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.3em" },
  { tag: tags.heading3, fontWeight: "700", fontSize: "1.15em" },
  { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.7" },
  {
    tag: highlightTag,
    backgroundColor: "color-mix(in srgb, #ffd60a 45%, transparent)",
    borderRadius: "2px",
  },
  {
    tag: tags.monospace,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    borderRadius: "3px",
  },
  { tag: tags.link, color: "#0a84ff", textDecoration: "underline" },
]);

export const livePreview = [hideMarkers, syntaxHighlighting(style)];
