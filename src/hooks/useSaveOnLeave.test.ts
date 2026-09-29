// @vitest-environment jsdom
// フォーカスが外れる・隠れる・窓を閉じるときに書き切る（spec §7.4 / 24-1）。
// 以前はどれも受けておらず、打って 0.8 秒以内に Cmd+Q や窓を閉じると最後の字が消えた

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

let closeHandler: (() => Promise<void>) | null = null;
vi.mock("../lib/ipc", () => ({
  onMainWindowCloseRequested: vi.fn((handler: () => Promise<void>) => {
    closeHandler = handler;
    return () => {
      closeHandler = null;
    };
  }),
}));

import { useSaveOnLeave } from "./useSaveOnLeave";

beforeEach(() => {
  closeHandler = null;
});

describe("useSaveOnLeave", () => {
  test("test_フォーカスが外れたら書き切る", () => {
    const flush = vi.fn(() => Promise.resolve());
    renderHook(() => useSaveOnLeave(flush));
    window.dispatchEvent(new Event("blur"));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test("test_窓が隠れたら書き切る", () => {
    const flush = vi.fn(() => Promise.resolve());
    renderHook(() => useSaveOnLeave(flush));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test("test_窓を閉じる前に書き切りを待つ", async () => {
    let finish: () => void = () => {};
    const flush = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    renderHook(() => useSaveOnLeave(flush));
    expect(closeHandler).not.toBeNull();
    let closed = false;
    const closing = closeHandler!().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(closed).toBe(false); // 書き終えるまで閉じない
    finish();
    await closing;
    expect(closed).toBe(true);
  });

  test("test_外すと受けなくなる", () => {
    const flush = vi.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => useSaveOnLeave(flush));
    unmount();
    window.dispatchEvent(new Event("blur"));
    expect(flush).not.toHaveBeenCalled();
    expect(closeHandler).toBeNull();
  });
});
