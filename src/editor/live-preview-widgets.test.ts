// @vitest-environment jsdom
// 本文に置く部品（live-preview-widgets）のうち、DOM を組んで確かめるもの。

import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, test, vi } from "vitest";
import { CheckboxWidget } from "./live-preview-widgets";

describe("CheckboxWidget", () => {
  test("test_読み取り専用の表示ではチェックボックスを押せない（24-5）", () => {
    // 前の版や埋め込みを見ているだけで、本文が書き換わってはいけない
    const dispatch = vi.fn();
    const view = {
      state: EditorState.create({
        doc: "- [ ] a",
        extensions: [EditorState.readOnly.of(true)],
      }),
      dispatch,
      posAtDOM: () => 2,
    } as unknown as EditorView;
    const box = new CheckboxWidget(false).toDOM(view) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("test_書ける表示では押すと印が切り替わる", () => {
    const dispatch = vi.fn();
    const view = {
      state: EditorState.create({ doc: "- [ ] a" }),
      dispatch,
      posAtDOM: () => 2,
    } as unknown as EditorView;
    const box = new CheckboxWidget(false).toDOM(view) as HTMLInputElement;
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 2, to: 5, insert: "[x]" },
    });
  });
});
