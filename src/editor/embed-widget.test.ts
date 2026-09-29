// @vitest-environment jsdom
// 埋め込みの部品（ADR-0058）の後始末（24-5）。読み込みを待つ間に部品が壊されたら、
// 遅れて届いた結果で入れ子のエディタも見張りも作らない

import { describe, expect, test, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EmbedWidget, embedResolver, type EmbedSource } from "./embed";

describe("EmbedWidget", () => {
  test("test_読み込みの前に壊されたら_入れ子のエディタも見張りも作らない", async () => {
    let answer: (found: EmbedSource | null) => void = () => {};
    const watch = vi.fn(() => vi.fn());
    const view = new EditorView({
      state: EditorState.create({
        extensions: [
          embedResolver.of({
            resolve: () => new Promise((resolve) => (answer = resolve)),
            open: vi.fn(),
            watch,
          }),
        ],
      }),
      parent: document.body,
    });
    const widget = new EmbedWidget("会議メモ");
    const dom = widget.toDOM(view);
    // キャレットが埋め込みの行に入った・見えない所へ流れた、で壊される
    widget.destroy(dom);
    answer({ path: "/v/会議メモ.md", text: "# 会議メモ\n本文\n" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 以前は壊れた部品の中に入れ子のエディタを作り、見張りを外す機会が来なかった
    expect(watch).not.toHaveBeenCalled();
    expect(dom.querySelector(".cm-editor")).toBeNull();
    view.destroy();
  });
});
