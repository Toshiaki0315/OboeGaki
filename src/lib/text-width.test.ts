// 文字の幅を測る（TASKS 8-10。仕様 MEAS-01 の代わり）。

import { describe, expect, it } from "vitest";
import { measureIn, SAFETY, wrapCount } from "./text-width";

/// 12pt = 1/6 インチ。読みやすさのために使う
const PT12 = 12;

describe("measureIn", () => {
  it("test_和文は 1 文字ぶんの幅（正方形として測る）", () => {
    // 12pt の全角 1 文字 = 12pt = 1/6 in（安全のぶんを含む）
    const one = measureIn("あ", PT12);
    expect(one).toBeCloseTo((PT12 / 72) * SAFETY, 4);
  });

  it("test_欧文は和文より狭い", () => {
    expect(measureIn("abcd", PT12)).toBeLessThan(measureIn("ああああ", PT12));
  });

  it("test_細い字と太い字を見分ける", () => {
    expect(measureIn("iii", PT12)).toBeLessThan(measureIn("MMM", PT12));
  });

  it("test_空文字は 0", () => {
    expect(measureIn("", PT12)).toBe(0);
  });

  it("test_字が大きくなれば比例して広くなる", () => {
    expect(measureIn("あ", 24)).toBeCloseTo(measureIn("あ", 12) * 2, 6);
  });

  it("test_絵文字は 1 文字ぶん（2 つに割らない）", () => {
    expect(measureIn("😀", PT12)).toBeCloseTo(measureIn("あ", PT12), 6);
  });
});

describe("wrapCount", () => {
  it("test_収まる文は 1 行", () => {
    expect(wrapCount("短い文", 4, PT12)).toBe(1);
  });

  it("test_和文はどこでも折れる", () => {
    // 幅 1in に 12pt の全角は 6 文字ぶん（安全のぶんで少し減る）
    const lines = wrapCount("あ".repeat(24), 1, PT12);
    expect(lines).toBeGreaterThanOrEqual(4);
    expect(lines).toBeLessThanOrEqual(6);
  });

  it("test_欧文は空白で折れる（語の途中で切らない）", () => {
    const lines = wrapCount("alpha beta gamma delta", 1, PT12);
    expect(lines).toBeGreaterThan(1);
  });

  it("test_長すぎる 1 語は諦めて切る（無限に伸ばさない）", () => {
    expect(wrapCount("a".repeat(200), 1, PT12)).toBeGreaterThan(1);
  });

  it("test_改行はそのまま行を分ける", () => {
    expect(wrapCount("あ\nい\nう", 4, PT12)).toBe(3);
  });

  it("test_空文字でも 1 行と数える（枠の高さの計算用）", () => {
    expect(wrapCount("", 4, PT12)).toBe(1);
  });

  it("test_幅が 0 以下なら 1 行として扱う（0 除算を持ち込まない）", () => {
    expect(wrapCount("あいうえお", 0, PT12)).toBe(1);
  });
});
