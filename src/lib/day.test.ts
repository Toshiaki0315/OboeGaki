// 日付の文字（TASKS 7-5）。

import { describe, expect, it } from "vitest";
import { clockValue, dayValue, stampValue } from "./day";

describe("dayValue", () => {
  it("test_年月日をゼロ詰めで返す", () => {
    expect(dayValue(new Date(2026, 8, 6, 12, 0))).toBe("2026-09-06");
    expect(dayValue(new Date(2026, 0, 1, 12, 0))).toBe("2026-01-01");
  });

  it("test_この機械の時間帯で数える（真夜中で前の日にしない）", () => {
    // `toISOString()` は UTC なので、日本の 0 時 30 分は前の日になる
    expect(dayValue(new Date(2026, 8, 6, 0, 30))).toBe("2026-09-06");
  });

  it("test_23 時台でも翌日にしない", () => {
    expect(dayValue(new Date(2026, 8, 6, 23, 30))).toBe("2026-09-06");
  });
});

// 4 か所に同じ pad + YYYY-MM-DD があった（note-order / pptx / StatusBar。19-3）
describe("stampValue / clockValue", () => {
  it("test_日付と時刻を分で", () => {
    expect(stampValue(new Date(2026, 8, 6, 9, 5))).toBe("2026-09-06 09:05");
  });
  it("test_時刻だけ", () => {
    expect(clockValue(new Date(2026, 8, 6, 9, 5))).toBe("09:05");
  });
});
