// 用紙とグリッド（TASKS 8-3。仕様 6 章 GR-01〜03 / CFG-01〜04）。

import { describe, expect, it } from "vitest";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";
import { deriveGrid, pageOf, slideMetrics, typeScale } from "./slide-grid";

const withPage = (page: Partial<PptxSettings["page"]>): PptxSettings => ({
  ...DEFAULT_PPTX_SETTINGS,
  page: { ...DEFAULT_PPTX_SETTINGS.page, ...page },
});

describe("pageOf（CFG-01 / CFG-02）", () => {
  it("test_既定は 16 対 9（13.333 × 7.5in）", () => {
    expect(pageOf(DEFAULT_PPTX_SETTINGS)).toEqual({
      widthIn: 13.333,
      heightIn: 7.5,
    });
  });

  it("test_プリセットの実寸を返す", () => {
    expect(pageOf(withPage({ preset: "4:3" }))).toEqual({
      widthIn: 10,
      heightIn: 7.5,
    });
    expect(pageOf(withPage({ preset: "a4-portrait" }))).toEqual({
      widthIn: 8.27,
      heightIn: 11.69,
    });
  });

  it("test_カスタムは設定の値を使う", () => {
    expect(
      pageOf(
        withPage({ preset: "custom", customWidthIn: 20, customHeightIn: 10 }),
      ),
    ).toEqual({ widthIn: 20, heightIn: 10 });
  });
});

describe("deriveGrid（GR-01 / GR-03）", () => {
  it("test_16対9 の既定はこれまでと同じ余白", () => {
    const grid = deriveGrid(13.333, 7.5, 1);
    expect(grid.marginX).toBeCloseTo(0.7, 3);
    expect(grid.columns).toBe(12);
    expect(grid.contentW).toBeCloseTo(13.333 - 0.7 * 2, 3);
  });

  it("test_幅に比例して余白が変わる", () => {
    const narrow = deriveGrid(10, 7.5, 1);
    expect(narrow.marginX).toBeLessThan(0.7);
    expect(narrow.marginX).toBeGreaterThanOrEqual(0.5); // 下限
  });

  it("test_余白の広い狭いが効く（CFG-44）", () => {
    const wide = deriveGrid(13.333, 7.5, 1.25);
    const compact = deriveGrid(13.333, 7.5, 0.8);
    expect(wide.marginX).toBeGreaterThan(compact.marginX);
  });

  it("test_幅 9in 未満は列を 6 に落とす（細すぎる列は役に立たない）", () => {
    expect(deriveGrid(8.27, 11.69, 1).columns).toBe(6);
    expect(deriveGrid(9, 7.5, 1).columns).toBe(12);
  });

  it("test_列の幅は溝を差し引いて割る", () => {
    const grid = deriveGrid(13.333, 7.5, 1);
    const total = grid.colW * grid.columns + grid.gutter * (grid.columns - 1);
    expect(total).toBeCloseTo(grid.contentW, 6);
  });

  it("test_余白は上下で同じ", () => {
    const grid = deriveGrid(13.333, 7.5, 1);
    expect(grid.marginTop).toBe(grid.marginBottom);
  });
});

describe("typeScale（GR-02）", () => {
  it("test_基準の高さでは 1 倍", () => {
    expect(typeScale(7.5)).toBe(1);
  });

  it("test_高いほど大きく、低いほど小さく", () => {
    expect(typeScale(11.69)).toBeGreaterThan(1);
    expect(typeScale(5)).toBeLessThan(1);
  });

  it("test_行きすぎは 0.7〜1.4 で止める", () => {
    expect(typeScale(56)).toBe(1.4);
    expect(typeScale(1)).toBe(0.7);
  });
});

describe("slideMetrics（GR-01 / GR-02 / CFG-38）", () => {
  it("test_既定は今までの字の大きさ", () => {
    const metrics = slideMetrics(DEFAULT_PPTX_SETTINGS);
    expect(metrics.points).toEqual({
      title: 30,
      body: 17,
      heading: 19,
      code: 13,
      table: 13,
    });
  });

  it("test_字の大小が全部に掛かる（CFG-38）", () => {
    const large = slideMetrics({
      ...DEFAULT_PPTX_SETTINGS,
      font: { ...DEFAULT_PPTX_SETTINGS.font, scale: "large" },
    });
    expect(large.points.body).toBe(20); // 17 × 1.15 = 19.55 → 20
    expect(large.points.title).toBe(35); // 30 × 1.15 = 34.5 → 35
  });

  it("test_用紙が変われば本文の始まりも余白も変わる", () => {
    const a4 = slideMetrics(withPage({ preset: "a4-portrait" }));
    const base = slideMetrics(DEFAULT_PPTX_SETTINGS);
    expect(a4.width).toBe(8.27);
    expect(a4.margin).toBeLessThan(base.margin); // 幅が狭いぶん余白も狭い
    expect(a4.bodyTop).toBeGreaterThan(base.bodyTop); // 縦長なので下がる
  });

  it("test_字が小さくなりすぎない", () => {
    const tiny = slideMetrics(
      withPage({ preset: "custom", customWidthIn: 4, customHeightIn: 1.2 }),
    );
    expect(tiny.points.code).toBeGreaterThanOrEqual(8);
  });
});
