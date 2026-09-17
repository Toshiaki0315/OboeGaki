// @vitest-environment jsdom
// 「最新値の ref」。App と useNoteSync に同じ 2 行が 10 組あった（17-6）
import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useLatest } from "./useLatest";

describe("useLatest", () => {
  test("test_描き直すたびに_current_が最新になる（参照は同じ）", () => {
    const { result, rerender } = renderHook(
      (value: string) => useLatest(value),
      { initialProps: "a" },
    );
    const ref = result.current;
    expect(ref.current).toBe("a");
    rerender("b");
    expect(result.current).toBe(ref);
    expect(ref.current).toBe("b");
  });
});
