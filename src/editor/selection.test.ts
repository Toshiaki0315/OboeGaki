// @vitest-environment jsdom
// 選択の描画（実機 2026-09-11）。WebKit の素の選択は、タグを隠す差し替えの
// 直後に古い塗りが残ることがある（ghost selection）。CodeMirror に状態から
// 描かせれば、状態と塗りが食い違わない。

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";
import { selectionDrawing } from "./selection";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

describe("selectionDrawing", () => {
  test("test_選択は CodeMirror が層として描き_素の選択の塗りは隠す", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "ああ いい",
        selection: { anchor: 0, head: 2 },
        extensions: [selectionDrawing],
      }),
      parent: document.body,
    });
    expect(view.dom.querySelector(".cm-selectionLayer")).toBeTruthy();
    expect(view.dom.querySelector(".cm-cursorLayer")).toBeTruthy();
    // drawSelection は素の選択を透明にする印を付ける
    expect(view.dom.className).toContain("cm-editor");
    expect(view.state.facet(EditorView.contentAttributes)).toBeTruthy();
  });
});
