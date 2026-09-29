import { describe, expect, it, test, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  dropFiles,
  insertionTarget,
  isImageFile,
  looksLikeAttachment,
  markdownFor,
  pickImages,
} from "./attachments";

// DOM の File を使わずに済むよう、判定は {name, type} の形だけ見る

describe("isImageFile", () => {
  it.each([
    ["MIME が image/*", { name: "x.bin", type: "image/png" }, true],
    ["拡張子が画像", { name: "photo.JPG", type: "" }, true],
    ["heic も画像", { name: "iphone.heic", type: "" }, true],
    ["svg も画像（要望 2026-09-09）", { name: "構成図.SVG", type: "" }, true],
    ["テキストは違う", { name: "memo.txt", type: "text/plain" }, false],
    ["拡張子なし", { name: "README", type: "" }, false],
  ])("test_%s", (_label, file, expected) => {
    expect(isImageFile(file)).toBe(expected);
  });
});

describe("pickImages / looksLikeAttachment", () => {
  it("test_画像だけを拾いテキストを素通しする", () => {
    const files = [
      { name: "a.png", type: "image/png" },
      { name: "b.txt", type: "text/plain" },
      { name: "c.webp", type: "" },
    ];
    expect(pickImages(files).map((f) => f.name)).toEqual(["a.png", "c.webp"]);
  });

  it("test_画像が混じっていれば添付として扱うつもりと判定する", () => {
    // 扱うつもりなら、読めなくても既定動作（file:// の文字列が本文へ
    // 落ちる）は止める — 参照実装 looks_like_attachment と同じ約束
    expect(looksLikeAttachment([{ name: "a.png", type: "" }])).toBe(true);
    expect(looksLikeAttachment([{ name: "a.txt", type: "" }])).toBe(false);
    expect(looksLikeAttachment([])).toBe(false);
  });
});

describe("markdownFor", () => {
  it("test_複数の添付は改行で繋ぐ", () => {
    expect(
      markdownFor(["![](attachments/a.png)", "![](attachments/b.png)"]),
    ).toBe("![](attachments/a.png)\n![](attachments/b.png)");
  });

  it("test_保存に失敗した分は落として繋ぐ", () => {
    expect(markdownFor(["![](a.png)", null, "![](b.png)"])).toBe(
      "![](a.png)\n![](b.png)",
    );
    expect(markdownFor([null, null])).toBe("");
  });
});

describe("insertionTarget（保存を待つ間に文書が変わったとき）", () => {
  // レビュー 2026-09-04: 保存前に捕まえた位置へそのまま挿しており、
  // 待っている間に打つと文字の途中へ割り込み、文書が縮むと
  // RangeError で落ちていた

  test("test_文書が変わっていなければ捕まえた位置", () => {
    const state = EditorState.create({ doc: "水と油" });
    expect(insertionTarget(state.doc, { from: 1, to: 2 }, state)).toEqual({
      from: 1,
      to: 2,
    });
  });

  test("test_文書が変わっていたら今のカーソル位置", () => {
    const before = Text.of(["古い文書"]);
    const state = EditorState.create({
      doc: "書き足した新しい文書",
      selection: { anchor: 5 },
    });
    expect(insertionTarget(before, { from: 7, to: 8 }, state)).toEqual({
      from: 5,
      to: 5,
    });
  });

  test("test_捕まえた位置が文書からはみ出す形は今のカーソルに落とす", () => {
    const state = EditorState.create({ doc: "短い", selection: { anchor: 0 } });
    expect(insertionTarget(state.doc, { from: 7, to: 9 }, state)).toEqual({
      from: 0,
      to: 0,
    });
  });
});

describe("変換中は差し込まない（24-5 / T5）", () => {
  /// 本物の EditorView は組まず、dropFiles が触るものだけ持つ入れ物
  function fakeView(doc: string) {
    const dispatch = vi.fn();
    const view = {
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
      composing: true,
      dom: { isConnected: true },
      dispatch,
      posAtCoords: () => null,
    };
    return { view, dispatch };
  }

  test("test_保存が終わっても変換中なら待ち_確定してから入れる", async () => {
    vi.useFakeTimers();
    try {
      const { view, dispatch } = fakeView("本文");
      const file = new File([new Uint8Array([1])], "a.png", {
        type: "image/png",
      });
      dropFiles(
        view as unknown as EditorView,
        [file],
        null,
        async () => "attachments/a.png",
      );
      await vi.advanceTimersByTimeAsync(200);
      // 変換中に dispatch すると、変換中の字と入れ違って壊れる
      expect(dispatch).not.toHaveBeenCalled();
      view.composing = false;
      await vi.advanceTimersByTimeAsync(200);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0].changes.insert).toContain(
        "attachments/a.png",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("test_変換中でなければ待たずに入れる", async () => {
    const { view, dispatch } = fakeView("本文");
    view.composing = false;
    const file = new File([new Uint8Array([1])], "a.png", {
      type: "image/png",
    });
    dropFiles(
      view as unknown as EditorView,
      [file],
      null,
      async () => "attachments/a.png",
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  });
});
