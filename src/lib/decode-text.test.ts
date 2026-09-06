// 落としたファイルの文字を読む（要望 2026-09-06）。

import { describe, expect, it } from "vitest";
import { decodeText } from "./decode-text";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("decodeText", () => {
  it("test_UTF-8 はそのまま読む", () => {
    expect(decodeText(utf8("名前,数\n"))).toBe("名前,数\n");
  });

  it("test_Shift_JIS も読む（Excel から来る）", () => {
    // 「こんにちは」の Shift_JIS
    const sjis = new Uint8Array([
      0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd,
    ]);
    expect(decodeText(sjis)).toBe("こんにちは");
  });

  it("test_BOM は落とす（先頭に見えない文字を残さない）", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("題")]);
    expect(decodeText(bom)).toBe("題");
  });

  it("test_空でも落ちない", () => {
    expect(decodeText(new Uint8Array())).toBe("");
  });
});
