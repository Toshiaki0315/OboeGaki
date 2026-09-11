// 選択の描画（実機 2026-09-11）。
//
// 素の選択（WebKit の ::selection）は、選択の両端が載っていた DOM ノードが
// 差し替えられると、次の selectionchange まで古い塗りが残ることがある
// （ghost selection）。おぼえがきはカーソルが離れた瞬間にタグを隠し、色の
// mark が span を切り直すので、選択が残ったままの差し替えが起きる。
// CodeMirror の drawSelection に**状態から**描かせれば、状態と塗りが
// 食い違うこと自体が起きない。IME の composition とは共存する（T5）。

import { drawSelection, EditorView } from "@codemirror/view";

export const selectionDrawing = [
  drawSelection(),
  EditorView.theme({
    // 色は OS の選択色に寄せる（今までの素の選択と同じ見え方）。フォーカス
    // が無いときは薄く
    ".cm-selectionBackground": {
      background: "color-mix(in srgb, Highlight 45%, transparent)",
    },
    "&.cm-focused .cm-selectionBackground": {
      background: "color-mix(in srgb, Highlight 75%, transparent)",
    },
  }),
];
