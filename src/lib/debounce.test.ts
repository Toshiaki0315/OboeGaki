import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDebouncer } from "./debounce";

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("遅延時間が経ってから 1 回だけ実行する", () => {
    const debouncer = createDebouncer(800);
    const action = vi.fn();
    debouncer.schedule(action);
    vi.advanceTimersByTime(799);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(debouncer.pending).toBe(false);
  });

  test("再予約で時計が巻き戻る（最後の変更から数える）", () => {
    const debouncer = createDebouncer(800);
    const action = vi.fn();
    debouncer.schedule(action);
    vi.advanceTimersByTime(700);
    debouncer.schedule(action);
    vi.advanceTimersByTime(700);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(action).toHaveBeenCalledTimes(1);
  });

  test("schedule は最後に渡した action を使う", () => {
    const debouncer = createDebouncer(800);
    const first = vi.fn();
    const second = vi.fn();
    debouncer.schedule(first);
    debouncer.schedule(second);
    vi.advanceTimersByTime(800);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("flush は予約を今すぐ実行する", () => {
    const debouncer = createDebouncer(800);
    const action = vi.fn();
    debouncer.schedule(action);
    debouncer.flush();
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(action).toHaveBeenCalledTimes(1); // 二重実行しない
  });

  test("flush は予約が無ければ何もしない", () => {
    const debouncer = createDebouncer(800);
    expect(() => debouncer.flush()).not.toThrow();
  });

  test("cancel は予約を破棄する", () => {
    const debouncer = createDebouncer(800);
    const action = vi.fn();
    debouncer.schedule(action);
    debouncer.cancel();
    vi.advanceTimersByTime(800);
    expect(action).not.toHaveBeenCalled();
    expect(debouncer.pending).toBe(false);
  });
});
