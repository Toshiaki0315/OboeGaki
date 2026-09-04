// 設定に出すフォントの候補（要望 2026-09-04）。
// **入っていないフォントは出さない。** 選べたのに何も変わらない、が
// いちばん分かりにくい（`Yu Gothic` や `SF Pro` は名前が違って解決されず、
// 候補に並んでいたが選んでも効かなかった）。

import { describe, expect, it } from "vitest";
import {
  availableFonts,
  BODY_FONTS,
  fontStack,
  isFontAvailable,
  MONO_FONTS,
} from "./fonts";

/// 幅を測る係の代役。`installed` に入っている名前だけ別の幅を返す。
function fakeMeasure(installed: readonly string[]) {
  return (spec: string) =>
    installed.some((name) => spec.includes(name)) ? 100 : 50;
}

describe("isFontAvailable", () => {
  it("test_入っていれば幅が変わるので分かる", () => {
    expect(isFontAvailable("Klee", fakeMeasure(["Klee"]))).toBe(true);
  });

  it("test_入っていなければ基準と同じ幅にしかならない", () => {
    expect(isFontAvailable("Yu Gothic", fakeMeasure(["Klee"]))).toBe(false);
  });

  it("test_名前に空白があっても囲んで測る", () => {
    const seen: string[] = [];
    isFontAvailable("BIZ UDGothic", (spec) => {
      seen.push(spec);
      return 50;
    });
    expect(seen.some((spec) => spec.includes(`"BIZ UDGothic"`))).toBe(true);
  });
});

describe("availableFonts", () => {
  const list = [
    { family: "Hiragino Sans", label: "和文ゴシック" },
    { family: "Klee", label: "和文楷書" },
  ];

  it("test_入っているものだけ残す", () => {
    expect(availableFonts(list, fakeMeasure(["Klee"]))).toEqual([
      { family: "Klee", label: "和文楷書" },
    ]);
  });

  it("test_測れない環境では候補をそのまま出す", () => {
    // 測る手立てが無いときに候補を空にすると、選ぶものが無くなる
    expect(availableFonts(list, null)).toEqual(list);
  });
});

describe("候補の中身", () => {
  it("test_この Mac に無い名前を並べない", () => {
    // CoreText の一覧で確かめた実在するファミリ名（2026-09-04）
    const missing = ["Yu Gothic", "Yu Mincho", "SF Pro", "SF Mono"];
    for (const font of [...BODY_FONTS, ...MONO_FONTS]) {
      expect(missing).not.toContain(font.family);
    }
  });

  it("test_等幅の候補には日本語も組めるものを含める", () => {
    // 等幅で日本語を書くと、CJK が別フォントに落ちて幅が揃わない（ADR-0003）
    expect(MONO_FONTS.map((font) => font.family)).toContain(
      "Source Han Code JP",
    );
  });

  it("test_すべてに短い説明が付いている", () => {
    for (const font of [...BODY_FONTS, ...MONO_FONTS]) {
      expect(font.label).not.toBe("");
    }
  });
});

describe("fontStack", () => {
  it("test_選んだフォントの後ろに逃げ道を足す", () => {
    // 別の Mac で開いたときに、無いフォントで文字が消えないように
    expect(fontStack("Klee")).toBe(`"Klee", -apple-system, sans-serif`);
    expect(fontStack("Klee", "monospace")).toBe(`"Klee", monospace`);
  });

  it("test_選んでいなければ空（既定のまま）", () => {
    expect(fontStack("")).toBe("");
  });
});
