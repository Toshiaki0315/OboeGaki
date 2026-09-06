// 書き出し前チェック（TASKS 8-5 の見張り / CFG-70）。

import { describe, expect, it } from "vitest";
import { splitDeck } from "./slides";
import { slideMetrics } from "./slide-grid";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";
import { overflowingSlides } from "./slide-lint";

const metrics = (patch: Partial<PptxSettings["page"]> = {}) =>
  slideMetrics({
    ...DEFAULT_PPTX_SETTINGS,
    page: { ...DEFAULT_PPTX_SETTINGS.page, ...patch },
  });

describe("overflowingSlides", () => {
  it("test_短い枚は溢れない", () => {
    const deck = splitDeck("# 題\n\n## A\n\n短い本文。\n");
    expect(overflowingSlides(deck, metrics())).toEqual([]);
  });

  it("test_長すぎる本文は溢れる", () => {
    const body = "あ".repeat(2000);
    const deck = splitDeck(`# 題\n\n## A\n\n${body}\n`);
    const found = overflowingSlides(deck, metrics());
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("A");
  });

  it("test_溢れた枚だけを返す", () => {
    const deck = splitDeck(
      `# 題\n\n## 短い\n\nあ\n\n## 長い\n\n${"い".repeat(2000)}\n`,
    );
    expect(overflowingSlides(deck, metrics()).map((s) => s.title)).toEqual([
      "長い",
    ]);
  });

  it("test_用紙が小さいほど溢れやすい", () => {
    const body = "う".repeat(700);
    const deck = splitDeck(`# 題\n\n## A\n\n${body}\n`);
    const small = metrics({
      preset: "custom",
      customWidthIn: 5,
      customHeightIn: 3.75,
    });
    expect(overflowingSlides(deck, small)).toHaveLength(1);
  });

  it("test_扉は数えない（題だけなので溢れない）", () => {
    const deck = splitDeck("# 題\n\n# 扉\n\n## A\n\nあ\n");
    expect(overflowingSlides(deck, metrics())).toEqual([]);
  });

  it("test_コードも高さに数える", () => {
    const code = [
      "```",
      ...Array.from({ length: 60 }, () => "let a = 1;"),
      "```",
    ].join("\n");
    const deck = splitDeck(`# 題\n\n## A\n\n${code}\n`);
    expect(overflowingSlides(deck, metrics())).toHaveLength(1);
  });
});
