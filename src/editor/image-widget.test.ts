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

  test("test_幅の無い SVG は viewBox の大きさで置く（300×150 に潰れない。要望 2026-09-09）", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"/>';
    const b64 = Buffer.from(svg, "utf8").toString("base64");
    const dom = new ImageWidget("attachments/a.svg", "構成図").toDOM(
      viewResolving(`data:image/svg+xml;base64,${b64}`),
    );
    await settle();
    const image = dom.querySelector("img")!;
    expect(image.style.width).toBe("640px");
    expect(image.style.height).toBe("auto");
  });

  test("test_SVG でも書き手が |300 と書けばそちらが勝つ", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"/>';
    const b64 = Buffer.from(svg, "utf8").toString("base64");
    const dom = new ImageWidget("attachments/a.svg", "構成図", 300).toDOM(
      viewResolving(`data:image/svg+xml;base64,${b64}`),
    );
    await settle();
    expect(dom.querySelector("img")!.style.width).toBe("300px");
  });
});
