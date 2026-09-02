// スパイク #2: Obsidian 型ライブプレビューの最小実装。
//
// 検証したいこと（hitofude の R4 / R7 に相当する性質が CM6 で成り立つか）:
//   1. マーカー（** や #）を Decoration.replace で隠しても、文書テキストは
//      1 文字も変わらない（ソースが唯一の真実 = R1 が構造的に保たれる）
//   2. カーソルが範囲に触れている間だけマーカーを見せる（近傍表示）
//   3. 装飾は Undo スタックに乗らない（Cmd+Z 1 回で直前の入力に戻る = R5 の懸念）
//   4. スパイク #1 の flanking 緩和が CM6 のハイライト経路でもそのまま効く

import { EditorView, Decoration, ViewPlugin, keymap } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { history, undo, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { relaxedAsterisk } from "./relaxed-emphasis.mjs";

// 隠す対象のマーカーノード。スパイクでは強調と見出しだけで一般性を示す
const MARK_NODES = new Set(["EmphasisMark", "HeaderMark"]);

// 選択がノード範囲に触れて（端を含む）いれば、そのノードのマーカーは見せる
function touchesSelection(state, from, to) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const hideMarkers = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.build(view);
    }
    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }
    build(view) {
      const builder = new RangeSetBuilder();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (!MARK_NODES.has(node.name)) return;
            // 親（Emphasis / ATXHeading1 など）の全域にカーソルが
            // 触れている間はソースを見せる
            const parent = node.node.parent;
            if (parent && touchesSelection(view.state, parent.from, parent.to)) return;
            // HeaderMark は直後の空白も一緒に隠す（`# ` の 2 文字）
            let end = node.to;
            if (node.name === "HeaderMark" && view.state.sliceDoc(end, end + 1) === " ") {
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
]);

const doc = `# 日本語の見出し

これは**強調**です。これは*斜体*です。
日本語の**強調**は前後が空白でなくても効く。
カギ括弧**「テスト」**のように内側が句読点でも効く。
入れ子は **bold *em* here** のように書ける。
snake_case_identifier は強調にならない。
`;

const view = new EditorView({
  parent: document.querySelector("#editor"),
  state: EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ extensions: [relaxedAsterisk] }),
      syntaxHighlighting(style),
      hideMarkers,
      EditorView.lineWrapping,
    ],
  }),
});

// 検証をコンソールから行うために公開する
window.view = view;
window.spikeUndo = () => undo(view);
