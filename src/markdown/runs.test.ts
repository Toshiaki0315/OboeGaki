// 装飾を持った文字のかたまり（ADR-0068）。Word と PowerPoint の書き出しが共有する

import { describe, expect, test } from "vitest";
import { plainText, sameStyle } from "./runs";

describe("Run", () => {
  test("test_plainText_は装飾を落として繋ぐ", () => {
    expect(plainText([{ text: "a", bold: true }, { text: "b" }])).toBe("ab");
  });

  test("test_sameStyle_は文字以外の全部が同じとき", () => {
    expect(
      sameStyle({ text: "a", bold: true }, { text: "b", bold: true }),
    ).toBe(true);
    expect(sameStyle({ text: "a", bold: true }, { text: "b" })).toBe(false);
    expect(sameStyle({ text: "a", link: "u" }, { text: "b", link: "v" })).toBe(
      false,
    );
  });
});
