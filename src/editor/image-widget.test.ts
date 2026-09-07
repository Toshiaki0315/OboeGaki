// @vitest-environment jsdom
// 本文の画像（ImageWidget）の描き方。`![説明](…)` の説明は画像の下に
// キャプションとして出し、載せたときの Tip にも入れる（要望 2026-09-08）。

import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { ImageWidget } from "./live-preview";

/// 画像の解決だけを差し替えた最小の view
function viewResolving(src: string | null): EditorView {
  return {
    state: { facet: () => async () => src },
    requestMeasure() {},
  } as unknown as EditorView;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ImageWidget", () => {
  test("test_説明は画像の下のキャプションと Tip に出る", async () => {
    const dom = new ImageWidget("attachments/a.png", "システム構成図").toDOM(
      viewResolving("data:image/png;base64,AA=="),
    );
    await settle();
    const image = dom.querySelector("img")!;
    expect(image.alt).toBe("システム構成図");
    expect(image.title).toBe("システム構成図");
    const caption = dom.querySelector(".cm-image-caption")!;
    expect(caption.textContent).toBe("システム構成図");
    // 順番は 絵 → 説明（下に出す）
    expect(Array.from(dom.children).map((c) => c.tagName)).toEqual([
      "IMG",
      "SPAN",
    ]);
  });

  test("test_説明が無ければキャプションは出さない", async () => {
    const dom = new ImageWidget("attachments/a.png", "").toDOM(
      viewResolving("data:image/png;base64,AA=="),
    );
    await settle();
    expect(dom.querySelector("img")).toBeTruthy();
    expect(dom.querySelector(".cm-image-caption")).toBeNull();
  });

  test("test_読めない画像は説明の文字が代役のまま", async () => {
    const dom = new ImageWidget("attachments/missing.png", "図").toDOM(
      viewResolving(null),
    );
    await settle();
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.textContent).toBe("図");
  });
});
