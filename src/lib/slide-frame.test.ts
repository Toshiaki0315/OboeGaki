// 枚の中の置き場所（TASKS 8-6 の土台 / GR-04）。

import { describe, expect, it } from "vitest";
import {
  bodyFrames,
  bodyLayout,
  estimateHeightIn,
  LABEL_H,
  type Frame,
} from "./slide-frame";
import { splitDeck } from "./slides";
import { slideMetrics } from "./slide-grid";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";

const sheetOf = (preset: PptxSettings["page"]["preset"]) =>
  slideMetrics({
    ...DEFAULT_PPTX_SETTINGS,
    page: { ...DEFAULT_PPTX_SETTINGS.page, preset },
  });

describe("bodyLayout（GR-04）", () => {
  it("test_画像が無ければ本文が全幅", () => {
    const sheet = sheetOf("16:9");
    const layout = bodyLayout(sheet, 0);
    expect(layout.bodyW).toBeCloseTo(sheet.contentW, 6);
    expect(layout.bodyY).toBeCloseTo(sheet.bodyTop, 6);
    expect(layout.images).toEqual([]);
  });

  it("test_横の用紙では本文が左、画像が右", () => {
    const sheet = sheetOf("16:9");
    const layout = bodyLayout(sheet, 1);
    expect(layout.bodyW).toBeLessThan(sheet.contentW);
    expect(layout.bodyY).toBeCloseTo(sheet.bodyTop, 6);
    expect(layout.images[0].x).toBeGreaterThan(
      layout.bodyX + layout.bodyW - 0.01,
    );
  });

  it("test_縦の用紙では画像が上、本文が下（GR-04）", () => {
    const sheet = sheetOf("a4-portrait");
    const layout = bodyLayout(sheet, 1);
    // 画像は上、本文はその下。本文は全幅を使える
    expect(layout.images[0].y).toBeCloseTo(sheet.bodyTop, 6);
    expect(layout.bodyY).toBeGreaterThan(layout.images[0].y);
    expect(layout.bodyW).toBeCloseTo(sheet.contentW, 6);
  });

  it("test_画像が複数でも紙からはみ出さない", () => {
    for (const preset of ["16:9", "a4-portrait"] as const) {
      const sheet = sheetOf(preset);
      for (const box of bodyLayout(sheet, 3).images) {
        expect(box.x).toBeGreaterThanOrEqual(sheet.margin - 0.001);
        expect(box.x + box.w).toBeLessThanOrEqual(
          sheet.width - sheet.margin + 0.001,
        );
        expect(box.y + box.h).toBeLessThanOrEqual(sheet.height + 0.001);
      }
    }
  });

  it("test_本文の高さは残りぶん（画像に食われる）", () => {
    const sheet = sheetOf("a4-portrait");
    expect(bodyLayout(sheet, 1).bodyH).toBeLessThan(sheet.bodyH);
    expect(bodyLayout(sheet, 0).bodyH).toBeCloseTo(sheet.bodyH, 6);
  });
});

describe("bodyFrames（枠は中身の分だけ。実機報告 2026-09-08）", () => {
  const sheet = sheetOf("16:9");
  const layout = bodyLayout(sheet, 0);
  const bottomOf = (frame: Frame) => frame.y + frame.h;
  const code = (lang: string) =>
    "```" + lang + "\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\n```\n";
  const blocksOf = (body: string) => {
    const deck = splitDeck(`# 題\n\n## A\n\n${body}`);
    const slide = deck.slides.find((s) => s.kind === "content")!;
    return slide.blocks;
  };

  it("test_本文が 1 行でコードが 2 つなら_全部が本文の高さに収まる", () => {
    const blocks = blocksOf(
      `短い説明。\n\n${code("python")}\n${code("javascript")}`,
    );
    const frames = bodyFrames(blocks, layout, true, sheet);
    expect(frames.map((f) => f.kind)).toEqual(["flow", "code", "code"]);
    for (const frame of frames) {
      expect(bottomOf(frame)).toBeLessThanOrEqual(
        layout.bodyY + layout.bodyH + 0.001,
      );
    }
    // 本文の枠は中身の分だけ（固定の 78% ではない）
    expect(frames[0].h).toBeLessThan(layout.bodyH * 0.3);
  });

  it("test_枠は上から順に重ならずに続く（言語名の帯も含めて）", () => {
    const blocks = blocksOf(
      `短い説明。\n\n${code("python")}\n${code("javascript")}`,
    );
    const frames = bodyFrames(blocks, layout, true, sheet);
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      const previous = bottomOf(frames[i - 1]);
      const gapForLabel = frame.kind === "code" && frame.label ? LABEL_H : 0;
      expect(frame.y).toBeGreaterThanOrEqual(previous + gapForLabel - 0.001);
    }
  });

  it("test_表は本文の直後に置き_行数ぶんの高さを持つ", () => {
    const table = "| a | b |\n| :-- | :-- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n";
    const blocks = blocksOf(`説明の文。\n\n${table}`);
    const frames = bodyFrames(blocks, layout, true, sheet);
    const flow = frames[0];
    const tbl = frames[1];
    expect(tbl.kind).toBe("table");
    expect(tbl.y).toBeCloseTo(bottomOf(flow), 6);
    // 4 行の表が 1 インチ足らずに押し込まれない
    expect(tbl.h).toBeGreaterThan(1.0);
    expect(bottomOf(tbl)).toBeLessThanOrEqual(
      layout.bodyY + layout.bodyH + 0.001,
    );
  });

  it("test_本文だけの枚は枠が本文の高さいっぱい（従来どおり）", () => {
    const frames = bodyFrames(
      blocksOf("説明の文。\n\n- 一つ\n- 二つ\n"),
      layout,
      true,
      sheet,
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].h).toBeCloseTo(layout.bodyH, 6);
  });

  it("test_置いた高さの合計は割る側の見積もりと同じ物差し", () => {
    const blocks = blocksOf(`短い説明。\n\n${code("python")}`);
    const frames = bodyFrames(blocks, layout, false, sheet);
    const total = frames.reduce((sum, f) => sum + f.h, 0);
    expect(total).toBeCloseTo(estimateHeightIn(blocks, layout.bodyW, sheet), 6);
  });
});
