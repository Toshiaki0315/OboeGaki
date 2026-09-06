// 色の読みやすさ（TASKS 8-7 / CFG-19 / L-04）。

import { describe, expect, it } from "vitest";
import { contrastRatio, contrastVerdict, luminance } from "./contrast";

describe("luminance", () => {
  it("test_白は 1、黒は 0", () => {
    expect(luminance("FFFFFF")).toBeCloseTo(1, 5);
    expect(luminance("000000")).toBeCloseTo(0, 5);
  });

  it("test_緑は赤より明るい（人の目の感じ方に合わせる）", () => {
    expect(luminance("00FF00")).toBeGreaterThan(luminance("FF0000"));
  });
});

describe("contrastRatio", () => {
  it("test_白と黒はいちばん開く（21:1）", () => {
    expect(contrastRatio("FFFFFF", "000000")).toBeCloseTo(21, 2);
  });

  it("test_同じ色なら 1:1", () => {
    expect(contrastRatio("1E2761", "1E2761")).toBeCloseTo(1, 5);
  });

  it("test_順番を入れ替えても同じ", () => {
    expect(contrastRatio("1E2761", "FFFFFF")).toBeCloseTo(
      contrastRatio("FFFFFF", "1E2761"),
      5,
    );
  });
});

describe("contrastVerdict（CFG-19）", () => {
  it("test_本文は 4.5:1 から", () => {
    expect(contrastVerdict("1E2761", "FFFFFF").body).toBe("ok");
    // 薄い灰色は本文には足りないが、大きな字なら通る
    const pale = contrastVerdict("949494", "FFFFFF");
    expect(pale.body).toBe("warn");
    expect(pale.heading).toBe("ok");
  });

  it("test_大きな字は 3:1 から", () => {
    expect(contrastVerdict("BBBBBB", "FFFFFF").heading).toBe("warn");
  });

  it("test_実測の比も返す（画面に数字で出す）", () => {
    const found = contrastVerdict("000000", "FFFFFF");
    expect(found.ratio).toBeCloseTo(21, 2);
  });
});
