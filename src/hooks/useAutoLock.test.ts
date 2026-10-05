// @vitest-environment jsdom
// 自動施錠（TASKS 13-3 / ADR-0062）。解錠している間、触らないまま一定時間が過ぎたら施錠する。

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAutoLock } from "./useAutoLock";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const MINUTE = 60_000;

describe("useAutoLock", () => {
  test("test_触らないまま時間が過ぎたら施錠する", () => {
    const onLock = vi.fn();
    renderHook(() => useAutoLock({ unlocked: true, minutes: 5, onLock }));
    act(() => vi.advanceTimersByTime(4 * MINUTE));
    expect(onLock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1.5 * MINUTE));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  test("test_打っている間は施錠しない", () => {
    const onLock = vi.fn();
    renderHook(() => useAutoLock({ unlocked: true, minutes: 5, onLock }));
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(3 * MINUTE));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    }
    expect(onLock).not.toHaveBeenCalled();
  });

  test("test_解錠していなければ何もしない", () => {
    const onLock = vi.fn();
    renderHook(() => useAutoLock({ unlocked: false, minutes: 5, onLock }));
    act(() => vi.advanceTimersByTime(60 * MINUTE));
    expect(onLock).not.toHaveBeenCalled();
  });

  test("test_画面を閉じて戻ってきたときも_過ぎていれば施錠する", () => {
    // スリープ中はタイマーが止まる。戻った瞬間に見る
    const onLock = vi.fn();
    renderHook(() => useAutoLock({ unlocked: true, minutes: 5, onLock }));
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
