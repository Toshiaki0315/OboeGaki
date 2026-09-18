// @vitest-environment jsdom
// 目次と統計（19-4 で App.tsx から切り出した）。隠れているときは数えない
// （ADR-0022）、打鍵ごとには数えず 300ms 置く、現在地はキャレット以前の最後の見出し

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OutlineItem } from "../editor/outline";
import { useOutline } from "./useOutline";

const ITEMS: OutlineItem[] = [
  { level: 1, text: "一", from: 0 },
  { level: 2, text: "二", from: 10 },
];
const STATS = { characters: 12, lines: 3 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function input(open: boolean, over = {}) {
  return {
    open,
    doc: "本文",
    currentPath: "/v/a.md",
    getOutline: vi.fn(() => ITEMS),
    getStats: vi.fn(() => STATS),
    ...over,
  };
}

describe("useOutline", () => {
  test("test_開いていれば目次を読み_閉じていれば空", () => {
    const given = input(true);
    const { result, rerender } = renderHook((props) => useOutline(props), {
      initialProps: given,
    });
    expect(result.current.items).toEqual(ITEMS);
    rerender({ ...given, open: false });
    expect(result.current.items).toEqual([]);
  });

  test("test_打鍵は_300ms_置いてまとめて数える", () => {
    const given = input(true);
    const { result } = renderHook(() => useOutline(given));
    expect(result.current.stats).toEqual(STATS); // 開いたときに 1 回
    given.getStats.mockReturnValue({ characters: 20, lines: 4 });
    act(() => result.current.docChanged());
    expect(result.current.stats).toEqual(STATS); // まだ
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.stats).toEqual({ characters: 20, lines: 4 });
  });

  test("test_現在地はキャレット以前の最後の見出し_閉じているときは動かさない", () => {
    const given = input(true);
    const { result } = renderHook(() => useOutline(given));
    act(() => result.current.cursorMoved(12));
    expect(result.current.currentIndex).toBe(1);
    act(() => result.current.cursorMoved(5));
    expect(result.current.currentIndex).toBe(0);
    const closed = renderHook(() => useOutline(input(false)));
    act(() => closed.result.current.cursorMoved(12));
    expect(closed.result.current.cursorPos).toBe(0);
  });
});
