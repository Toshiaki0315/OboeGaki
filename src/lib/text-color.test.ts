import { describe, expect, test } from "vitest";
import {
  COLOR_PALETTE,
  colorSpanOpen,
  parseColorSpan,
  styleAttribute,
} from "./text-color";

// 本文の文字色（ADR-0061）。`<span style="…">` のうち受けるものの判定
describe("parseColorSpan", () => {
  test("test_color と background-color だけを受ける_色名と 16 進", () => {
    expect(parseColorSpan("color: red;")).toEqual({ color: "red" });
    expect(parseColorSpan("color:#E53935")).toEqual({ color: "#e53935" });
    expect(parseColorSpan("background-color: #ff0; color: #123456")).toEqual({
      color: "#123456",
      background: "#ff0",
    });
  });
  test("test_他の属性や値が 1 つでも混じれば受けない（壊さない・通さない）", () => {
    expect(parseColorSpan("color: red; font-size: 2em")).toBeNull();
    expect(parseColorSpan("color: url(x)")).toBeNull();
    expect(parseColorSpan("color: red !important")).toBeNull();
    expect(parseColorSpan("color: expression(1)")).toBeNull();
    expect(parseColorSpan("color: #12")).toBeNull();
    expect(parseColorSpan("")).toBeNull();
  });
});

describe("styleAttribute / colorSpanOpen", () => {
  test("test_受けた色をこちらで組み直す（書いた属性は素通りさせない）", () => {
    expect(styleAttribute({ color: "red", background: "#ff0" })).toBe(
      "color:red;background-color:#ff0",
    );
    expect(colorSpanOpen("#E53935")).toBe('<span style="color: #e53935">');
  });
  test("test_パレットは 6 色_値は 16 進", () => {
    expect(COLOR_PALETTE).toHaveLength(6);
    for (const swatch of COLOR_PALETTE) {
      expect(swatch.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(swatch.label).not.toBe("");
    }
  });
});
