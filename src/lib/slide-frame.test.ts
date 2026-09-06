// 枚の中の置き場所（TASKS 8-6 の土台 / GR-04）。

import { describe, expect, it } from "vitest";
import { bodyLayout } from "./slide-frame";
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
