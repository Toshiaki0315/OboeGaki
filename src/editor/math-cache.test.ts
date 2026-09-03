// renderMath の結果キャッシュ（レビュー 2026-09-04 の性能退行対応）。
// 装飾の再計算のたびに全数式を Temml で組み直すと、数式の多いノートで
// 打鍵 p95 が 16ms を割る。同じ式は一度しか組まないことを固定する。

import { beforeEach, describe, expect, test, vi } from "vitest";

const renderToString = vi.hoisted(() =>
  vi.fn((latex: string) => `<math>${latex}</math>`),
);
vi.mock("temml", () => ({ default: { renderToString } }));

import { renderMath } from "./math";

describe("renderMath のキャッシュ", () => {
  beforeEach(() => renderToString.mockClear());

  test("test_同じ式は一度しか組まない", () => {
    const first = renderMath("E = mc^2", true);
    const second = renderMath("E = mc^2", true);
    expect(first).toBe("<math>E = mc^2</math>");
    expect(second).toBe(first);
    expect(renderToString).toHaveBeenCalledTimes(1);
  });

  test("test_インラインとブロックは別々に数える", () => {
    renderMath("x", true);
    renderMath("x", false);
    expect(renderToString).toHaveBeenCalledTimes(2);
  });

  test("test_組めない式も組み直さない", () => {
    renderToString.mockImplementationOnce(() => {
      throw new Error("parse error");
    });
    expect(renderMath("\\broken{", false)).toBeNull();
    expect(renderMath("\\broken{", false)).toBeNull();
    expect(renderToString).toHaveBeenCalledTimes(1);
  });
});
