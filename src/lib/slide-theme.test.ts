// スライドの見た目（TASKS 5-5）。md2pptx のメタデータ相当を front matter から。

import { describe, expect, it } from "vitest";
import { DEFAULT_SLIDE_THEME, readSlideTheme } from "./slide-theme";

describe("readSlideTheme", () => {
  it("test_書いていなければ既定のまま", () => {
    expect(readSlideTheme("# 題\n")).toEqual(DEFAULT_SLIDE_THEME);
  });

  it("test_書体と色を front matter から読む", () => {
    const text = [
      "---",
      "slide-font: Hiragino Sans",
      "slide-mono: Menlo",
      "slide-accent: '#0A84FF'",
      "---",
      "",
      "# 題",
    ].join("\n");
    expect(readSlideTheme(text)).toEqual({
      font: "Hiragino Sans",
      mono: "Menlo",
      accent: "0A84FF",
    });
  });

  it("test_色は_なしでも読む", () => {
    expect(readSlideTheme("---\nslide-accent: 44546A\n---\n").accent).toBe(
      "44546A",
    );
  });

  it("test_読めない色は既定へ倒す（書き出しを止めない）", () => {
    // 打ち間違いで書き出せなくなるより、既定で出るほうがよい
    expect(readSlideTheme("---\nslide-accent: あか\n---\n").accent).toBe(
      DEFAULT_SLIDE_THEME.accent,
    );
    expect(readSlideTheme("---\nslide-accent: '#12345'\n---\n").accent).toBe(
      DEFAULT_SLIDE_THEME.accent,
    );
  });

  it("test_小文字の色は大文字に揃える", () => {
    expect(readSlideTheme("---\nslide-accent: '#0a84ff'\n---\n").accent).toBe(
      "0A84FF",
    );
  });

  it("test_空の書体は既定のまま（空で上書きしない）", () => {
    expect(readSlideTheme("---\nslide-font: ''\n---\n").font).toBe(
      DEFAULT_SLIDE_THEME.font,
    );
  });
});
