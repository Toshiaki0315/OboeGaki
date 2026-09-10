import { describe, expect, test } from "vitest";
import { firstHeading, sanitizeStem } from "./note-title";

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
