// プレビュー（TASKS 8-6 / PV-01〜05）。

import { describe, expect, it } from "vitest";
import { previewOf, SAMPLE_DECKS } from "./slide-preview";
import { slideMetrics } from "./slide-grid";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";

const settings = (patch: Partial<PptxSettings["page"]> = {}): PptxSettings => ({
  ...DEFAULT_PPTX_SETTINGS,
  page: { ...DEFAULT_PPTX_SETTINGS.page, ...patch },
});

describe("SAMPLE_DECKS（PV-02）", () => {
  it("test_見本は 4 種（表紙・箇条書き・比較・画像つき）", () => {
    expect(SAMPLE_DECKS).toHaveLength(4);
    for (const sample of SAMPLE_DECKS) {
      expect(sample.name).not.toBe("");
      expect(sample.markdown).not.toBe("");
    }
  });
});

describe("previewOf（PV-01）", () => {
  it("test_紙の形は設定の用紙どおり", () => {
    const wide = previewOf(SAMPLE_DECKS[1].markdown, settings());
    expect(wide.widthIn).toBeCloseTo(13.333, 3);
    expect(wide.heightIn).toBeCloseTo(7.5, 3);
    const tall = previewOf(
      SAMPLE_DECKS[1].markdown,
      settings({ preset: "a4-portrait" }),
    );
    expect(tall.heightIn).toBeGreaterThan(tall.widthIn);
  });

  it("test_枠は書き出しと同じ計算から出す", () => {
    const config = settings();
    const page = previewOf(SAMPLE_DECKS[1].markdown, config).pages[0];
    const sheet = slideMetrics(config);
    const title = page.frames.find((frame) => frame.kind === "title");
    expect(title?.y).toBeCloseTo(sheet.titleY, 6);
    expect(title?.x).toBeCloseTo(sheet.margin, 6);
  });

  it("test_本文の枠が題の下に来る", () => {
    const page = previewOf(SAMPLE_DECKS[1].markdown, settings()).pages[0];
    const title = page.frames.find((f) => f.kind === "title");
    const body = page.frames.find((f) => f.kind === "flow");
    expect(body!.y).toBeGreaterThan(title!.y);
  });

  it("test_表紙は題と副題を持つ", () => {
    const page = previewOf(SAMPLE_DECKS[0].markdown, settings()).pages[0];
    expect(page.frames.map((frame) => frame.kind)).toContain("cover");
  });

  it("test_見せるのは先頭の数枚だけ（重くしない）", () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `## ${i}\n\n本文 ${i}\n`,
    ).join("\n");
    expect(previewOf(many, settings()).pages.length).toBeLessThanOrEqual(5);
  });

  it("test_設定の枚割りを通したあとの姿を見せる", () => {
    // 箇条書きの上限を 3 にすると、7 項目は 3 枚に割れる
    const doc = `## A\n\n${Array.from({ length: 7 }, (_, i) => `- 項目${i}`).join("\n")}\n`;
    const config: PptxSettings = {
      ...settings(),
      layout: { ...DEFAULT_PPTX_SETTINGS.layout, maxBulletItems: 3 },
    };
    expect(previewOf(doc, config).pages).toHaveLength(3);
  });

  it("test_中身が無くても落ちない", () => {
    expect(previewOf("", settings()).pages).toEqual([]);
  });
});
