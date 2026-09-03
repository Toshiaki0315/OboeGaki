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

describe("非同期 action と flush の完了待ち", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // レビュー 2026-09-04: flush が「発射」しか保証せず、保存（非同期）の
  // 完了前に改名・ピン留め・書き出しが走ってデータが巻き戻っていた

  test("test_flushは非同期actionの完了まで待てる", async () => {
    const debouncer = createDebouncer(800);
    let settled = false;
    debouncer.schedule(async () => {
      await Promise.resolve();
      settled = true;
    });
    await debouncer.flush();
    expect(settled).toBe(true);
  });

  test("test_発射済みで実行中の保存もflushで待てる", async () => {
    const debouncer = createDebouncer(800);
    let release!: () => void;
    let settled = false;
    debouncer.schedule(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            settled = true;
            resolve();
          };
        }),
    );
    vi.advanceTimersByTime(800); // タイマーで発射（まだ完了していない）
    expect(debouncer.pending).toBe(false);
    const waited = debouncer.flush(); // 予約は無いが、実行中を待つ
    release();
    await waited;
    expect(settled).toBe(true);
  });

  test("test_実行中に次が発射されても直列になる", async () => {
    const debouncer = createDebouncer(800);
    const order: string[] = [];
    let releaseFirst!: () => void;
    debouncer.schedule(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
          order.push("first-start");
        }),
    );
    vi.advanceTimersByTime(800);
    debouncer.schedule(async () => {
      order.push("second-start");
    });
    const waited = debouncer.flush();
    order.push("first-release");
    releaseFirst();
    await waited;
    expect(order).toEqual(["first-start", "first-release", "second-start"]);
  });

  test("test_flushは予約も実行中も無ければ即座に解決する", async () => {
    const debouncer = createDebouncer(800);
    await expect(debouncer.flush()).resolves.toBeUndefined();
  });
});
