import { describe, expect, test } from "vitest";
import { sectionOf, splitEmbedTarget } from "./section";

// 埋め込み `![[ノート名#見出し]]`（ADR-0058 / 12-7）の名前と節の切り出し
describe("splitEmbedTarget", () => {
  test("test_名前と見出しに分ける_見出しは無くてもよい", () => {
    expect(splitEmbedTarget("会議メモ#決定事項")).toEqual({
      name: "会議メモ",
      heading: "決定事項",
    });
    expect(splitEmbedTarget(" 会議メモ ")).toEqual({
      name: "会議メモ",
      heading: null,
    });
  });
});

describe("sectionOf", () => {
  const text =
    "# 題\n\n前書き\n\n## 決定事項\n\n- a\n- b\n\n### 補足\n\n細かい\n\n## 次回\n\n未定\n";
  test("test_その見出しから_同じか浅い次の見出しの手前まで（深い小見出しは含む）", () => {
    expect(sectionOf(text, "決定事項")).toBe(
      "## 決定事項\n\n- a\n- b\n\n### 補足\n\n細かい\n",
    );
    expect(sectionOf(text, "次回")).toBe("## 次回\n\n未定\n");
  });
  test("test_見出しが無ければ null_大小と前後の空白は無視", () => {
    expect(sectionOf(text, "無い")).toBeNull();
    expect(sectionOf("# Title\n\nx\n", " title ")).toBe("# Title\n\nx\n");
  });
});

describe("sectionOf のコードフェンス", () => {
  test("test_同じ字で同じ長さ以上の行でだけ閉じる（```` の中の ``` は閉じない）", () => {
    // Rust の mcp::section_end と同じ規則（レビュー 2026-09-14）
    const text = "## A\n\n````md\n```\n## 中\n```\n````\n\n## B\n";
    const section = sectionOf(text, "A");
    expect(section).toContain("## 中");
    expect(section).not.toContain("## B");
    const mixed = "## A\n\n~~~\n```\n## 中\n~~~\n\n## B\n";
    const found = sectionOf(mixed, "A");
    expect(found).toContain("## 中");
    expect(found).not.toContain("## B");
  });
});
