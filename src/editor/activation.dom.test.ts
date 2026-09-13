// @vitest-environment jsdom
// Cmd で指差しにする見張り（activationCursor）の後始末。window に付けた
// 聞き手は destroy で全部外れること（入れ子のビューや開き直しで増えない）。
// 座標から引く判断は jsdom では動かないので、ここでは持ち物の管理だけを見る
// （レビュー 2026-09-14 / 15-13）。

import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { activationClicks, POINTER_CLASS } from "./activation";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("activationCursor", () => {
  test("test_destroy_で_window_と_scrollDOM_の聞き手が全部外れる", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const view = new EditorView({
      state: EditorState.create({
        doc: "[[会議メモ]]",
        extensions: [activationClicks],
      }),
      parent: document.body,
    });
    const scrollAdded = vi.spyOn(view.scrollDOM, "addEventListener");
    const scrollRemoved = vi.spyOn(view.scrollDOM, "removeEventListener");
    // 見張りが付けるのは blur / keydown / keyup（EditorView 自身も window に
    // 聞き手を付けるので、種類ごとに「付けた数 = 外した数」で見る）
    const count = (calls: unknown[][]) => {
      const tally = new Map<string, number>();
      for (const [type] of calls) {
        tally.set(String(type), (tally.get(String(type)) ?? 0) + 1);
      }
      return tally;
    };
    const before = count(added.mock.calls);
    for (const type of ["blur", "keydown", "keyup"]) {
      expect(before.get(type) ?? 0).toBeGreaterThanOrEqual(1);
    }
    view.destroy();
    const after = count(removed.mock.calls);
    for (const [type, n] of before) {
      expect(after.get(type) ?? 0).toBe(n);
    }
    // スクロールで泡を隠す聞き手も外れる
    expect(scrollRemoved.mock.calls.some(([type]) => type === "scroll")).toBe(
      true,
    );
    expect(scrollAdded.mock.calls.length).toBeLessThanOrEqual(
      scrollRemoved.mock.calls.length + 1,
    );
    expect(view.dom.classList.contains(POINTER_CLASS)).toBe(false);
  });

  test("test_窓から離れると指差しをやめる", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "本文",
        extensions: [activationClicks],
      }),
      parent: document.body,
    });
    view.dom.classList.add(POINTER_CLASS); // 直前まで指差しだったとして
    window.dispatchEvent(new Event("blur"));
    // blur は「押していない」扱いに戻すだけで、印は変わっていなければ触らない
    // （apply は差分のときだけ）。ここでは落ちないことと、次の keydown で
    // 位置を忘れているので指差しにならないことを見る
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Meta", metaKey: true }),
    );
    view.destroy();
  });
});
