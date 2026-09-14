// @vitest-environment jsdom
// 本文の画像（ImageWidget）の描き方。`![説明](…)` の説明は画像の下に
// キャプションとして出し、載せたときの Tip にも入れる（要望 2026-09-08）。

import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, test, vi } from "vitest";
import { ImageWidget, imageResolver } from "./live-preview";

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
    // 順番は 絵（つまみと一緒の枠）→ 説明（下に出す）
    expect(Array.from(dom.children).map((c) => c.className)).toEqual([
      "cm-image-frame",
      "cm-image-caption",
    ]);
    expect(dom.firstElementChild?.firstElementChild?.tagName).toBe("IMG");
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

/// 掴んで大きさを変える（6-8b）。本物の EditorView は組まず、必要なものだけ
/// （本文を持つ state・dispatch・posAtDOM）を持つ入れ物で試す
function editable(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown(),
      imageResolver.of(async () => "data:image/png;base64,AA=="),
    ],
  });
  const dispatch = vi.fn();
  const view = {
    state,
    dispatch,
    posAtDOM: () => 0,
    requestMeasure() {},
  } as unknown as EditorView;
  return { view, dispatch };
}

const mouse = (type: string, clientX: number) =>
  new MouseEvent(type, { clientX, clientY: 0, bubbles: true, button: 0 });

describe("ImageWidget を掴んで大きさを変える（6-8b）", () => {
  test("test_絵の右下につまみが出る", async () => {
    const { view } = editable("![犬|300](attachments/a.png)");
    const dom = new ImageWidget("attachments/a.png", "犬", 300).toDOM(view);
    await settle();
    expect(dom.querySelector(".cm-image-resize")).not.toBeNull();
  });

  test("test_右へ引いて離すと_本文の幅が増える（縦は書かない）", async () => {
    const doc = "![犬|300x200](attachments/a.png)";
    const { view, dispatch } = editable(doc);
    const dom = new ImageWidget("attachments/a.png", "犬", 300, 200).toDOM(
      view,
    );
    await settle();
    const handle = dom.querySelector(".cm-image-resize")!;
    handle.dispatchEvent(mouse("mousedown", 100));
    window.dispatchEvent(mouse("mousemove", 150));
    // 引いている間は絵だけが先に変わる（本文はまだ）
    expect(dom.querySelector("img")!.style.width).toBe("350px");
    expect(dispatch).not.toHaveBeenCalled();
    window.dispatchEvent(mouse("mouseup", 150));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toEqual({
      changes: {
        from: 0,
        to: doc.length,
        insert: "![犬|350](attachments/a.png)",
      },
    });
  });

  test("test_動かさずに離せば本文は触らない", async () => {
    const { view, dispatch } = editable("![犬|300](attachments/a.png)");
    const dom = new ImageWidget("attachments/a.png", "犬", 300).toDOM(view);
    await settle();
    const handle = dom.querySelector(".cm-image-resize")!;
    handle.dispatchEvent(mouse("mousedown", 100));
    window.dispatchEvent(mouse("mouseup", 100));
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("test_つまみの上のマウス操作はエディタに渡さない（行が開いて絵が消えない）", async () => {
    const { view } = editable("![犬|300](attachments/a.png)");
    const widget = new ImageWidget("attachments/a.png", "犬", 300);
    const dom = widget.toDOM(view);
    await settle();
    const handle = dom.querySelector(".cm-image-resize")!;
    const onHandle = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(onHandle, "target", { value: handle });
    expect(widget.ignoreEvent(onHandle)).toBe(true);
    const onImage = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(onImage, "target", {
      value: dom.querySelector("img"),
    });
    expect(widget.ignoreEvent(onImage)).toBe(false);
  });
});
