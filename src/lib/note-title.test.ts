import { describe, expect, test } from "vitest";
import { firstHeading, sanitizeStem, stripInline } from "./note-title";

// 見出しとファイル名の追従（ADR-0005 追記、要望 2026-09-10）

describe("firstHeading", () => {
  test("test_最初の H1 の文字を返す（# と空白は落とし、連続空白は 1 つに）", () => {
    expect(firstHeading("前書き\n\n#  会議   メモ \n\n本文")).toBe("会議 メモ");
  });
  test("test_H2 以下は見出しとして数えない（一番上の見出し = H1）", () => {
    expect(firstHeading("## 小見出し\n\n本文")).toBeNull();
    expect(firstHeading("## 小見出し\n\n# 大見出し")).toBe("大見出し");
  });
  test("test_front matter とコードフェンスの中は見出しではない", () => {
    expect(
      firstHeading("---\ntitle: x\n---\n```\n# コード\n```\n# 本当の見出し"),
    ).toBe("本当の見出し");
    expect(firstHeading("---\n# 中\n---\n本文")).toBeNull();
  });
  test("test_# だけ・#直後に空白が無い行は見出しではない", () => {
    expect(firstHeading("#\n#タグ\n本文")).toBeNull();
  });
});

describe("sanitizeStem", () => {
  test("test_パス区切りと : はハイフン_空白は畳む_先頭のドットは剥がす（Rust の sanitize_filename と同じ）", () => {
    expect(sanitizeStem("定例 1/15: 進捗\\報告")).toBe("定例 1-15- 進捗-報告");
    expect(sanitizeStem("  ..隠し  名前  ")).toBe("隠し 名前");
    expect(sanitizeStem("   ")).toBe("");
  });
});

// 見出しの装飾は題名に持ち込まない（実機 2026-09-11: 色と打ち消しを付けた
// H1 がそのままファイル名とタイトルバーに出た）
describe("stripInline", () => {
  test("test_色の span_打ち消し_太字_斜体_コード_マーカーの記号を落とす", () => {
    expect(stripInline('<span style="color: #1e88e5">~~無題~~</span>')).toBe(
      "無題",
    );
    expect(stripInline("**太い** *斜め* `code` ::目立つ::")).toBe(
      "太い 斜め code 目立つ",
    );
  });
  test("test_リンクは文字だけ_WikiLink は名前_画像は説明", () => {
    expect(
      stripInline("[説明](https://x.com) と [[ノート|表示]] と ![絵](a.png)"),
    ).toBe("説明 と 表示 と 絵");
  });
  test("test_受けない HTML タグも落とす（本文には残る。題名に出さないだけ）", () => {
    expect(stripInline('<span style="font-size: 2em">大</span><br>き')).toBe(
      "大き",
    );
  });
  test("test_firstHeading は素の文字を返す", () => {
    expect(
      firstHeading('# <span style="color: red">~~会議~~</span> **メモ**\n本文'),
    ).toBe("会議 メモ");
  });
});
