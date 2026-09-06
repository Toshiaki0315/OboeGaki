// スライドの見た目（TASKS 5-5）。md2pptx のメタデータ相当を front matter から。

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_THEME,
  readSlideTheme,
  slideThemeFrom,
} from "./slide-theme";
import { DEFAULT_PPTX_SETTINGS } from "./pptx-settings";

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

  it("test_既定はテーマの色を指す（ADR-0045）", () => {
    // 生の値だと、テンプレートを当ててもここだけ変わらない
    expect(DEFAULT_SLIDE_THEME.accent).toBe("accent1");
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

describe("環境設定を土台にする（TASKS 8-2 / ADR-0046 の決定 4）", () => {
  const base = { font: "Meiryo", mono: "Consolas", accent: "1E2761" };

  it("test_front_matter_が無ければ設定の値を使う", () => {
    expect(readSlideTheme("# 題\n", base)).toEqual(base);
  });

  it("test_front_matter_が勝つ（SC-02 > SC-01）", () => {
    const text = "---\nslide-font: Hiragino Sans\n---\n\n# 題\n";
    expect(readSlideTheme(text, base)).toEqual({
      font: "Hiragino Sans",
      mono: "Consolas",
      accent: "1E2761",
    });
  });

  it("test_読めない値は設定へ倒す（既定へは戻さない）", () => {
    const text = "---\nslide-accent: まっか\n---\n\n# 題\n";
    expect(readSlideTheme(text, base).accent).toBe("1E2761");
  });
});

describe("slideThemeFrom（CFG-30〜32 / CFG-12）", () => {
  it("test_テーマ参照の色はそのまま渡す", () => {
    const theme = slideThemeFrom(DEFAULT_PPTX_SETTINGS);
    expect(theme.accent).toBe("accent1");
  });

  it("test_具体色は 6 桁で渡す", () => {
    const settings = {
      ...DEFAULT_PPTX_SETTINGS,
      theme: {
        ...DEFAULT_PPTX_SETTINGS.theme,
        palette: {
          ...DEFAULT_PPTX_SETTINGS.theme.palette,
          accent: { hex: "1E2761" },
        },
      },
      font: { ...DEFAULT_PPTX_SETTINGS.font, jp: "Meiryo", mono: "Consolas" },
    };
    expect(slideThemeFrom(settings)).toEqual({
      font: "Meiryo",
      mono: "Consolas",
      accent: "1E2761",
    });
  });

  it("test_書体を選んでいなければ既定のまま", () => {
    const theme = slideThemeFrom(DEFAULT_PPTX_SETTINGS);
    expect(theme.font).toBe(DEFAULT_SLIDE_THEME.font);
    expect(theme.mono).toBe(DEFAULT_SLIDE_THEME.mono);
  });
});
