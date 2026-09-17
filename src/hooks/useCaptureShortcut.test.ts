// @vitest-environment jsdom
// どこからでも書き取りのショートカット（ADR-0057）。設定の字を OS に登録し、
// 変われば付け替え、空なら外す。Tauri への包み（lib/ipc）は差し替える。

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  registerGlobalShortcut: vi.fn(),
  unregisterGlobalShortcut: vi.fn(),
  openCaptureWindow: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { useCaptureShortcut } from "./useCaptureShortcut";

const mocked = vi.mocked(ipc);

beforeEach(() => {
  vi.resetAllMocks();
  mocked.registerGlobalShortcut.mockResolvedValue(undefined);
  mocked.unregisterGlobalShortcut.mockResolvedValue(undefined);
  mocked.openCaptureWindow.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("useCaptureShortcut", () => {
  test("test_設定の字を前後の空白を落として登録する", async () => {
    renderHook(() => useCaptureShortcut(" Alt+Space "));
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalledWith(
        "Alt+Space",
        expect.any(Function),
      ),
    );
  });

  test("test_空なら登録しない", async () => {
    renderHook(() => useCaptureShortcut("   "));
    await Promise.resolve();
    expect(mocked.registerGlobalShortcut).not.toHaveBeenCalled();
  });

  test("test_変わったら外してから付け替え_外れるときも外す", async () => {
    const { rerender, unmount } = renderHook(
      (key: string) => useCaptureShortcut(key),
      { initialProps: "A" },
    );
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalledWith(
        "A",
        expect.any(Function),
      ),
    );
    rerender("B");
    await waitFor(() =>
      expect(mocked.unregisterGlobalShortcut).toHaveBeenCalledWith("A"),
    );
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalledWith(
        "B",
        expect.any(Function),
      ),
    );
    unmount();
    await waitFor(() =>
      expect(mocked.unregisterGlobalShortcut).toHaveBeenCalledWith("B"),
    );
  });

  test("test_登録が済む前に設定が変わっていたら_その場で外す", async () => {
    const gate: { finish: (() => void) | null } = { finish: null };
    mocked.registerGlobalShortcut.mockImplementation(
      () => new Promise<void>((done) => (gate.finish = done)),
    );
    const { unmount } = renderHook(() => useCaptureShortcut("A"));
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalled(),
    );
    unmount(); // まだ登録が終わっていない
    expect(mocked.unregisterGlobalShortcut).not.toHaveBeenCalled();
    gate.finish?.();
    await waitFor(() =>
      expect(mocked.unregisterGlobalShortcut).toHaveBeenCalledWith("A"),
    );
  });

  test("test_登録できなくても落ちない（他のアプリが使っている・Tauri の外）", async () => {
    mocked.registerGlobalShortcut.mockRejectedValue(new Error("busy"));
    expect(() => renderHook(() => useCaptureShortcut("A"))).not.toThrow();
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalled(),
    );
  });

  test("test_押されたら書き取りの窓を出す", async () => {
    renderHook(() => useCaptureShortcut("A"));
    await waitFor(() =>
      expect(mocked.registerGlobalShortcut).toHaveBeenCalled(),
    );
    const onPressed = mocked.registerGlobalShortcut.mock.calls[0][1];
    onPressed();
    expect(mocked.openCaptureWindow).toHaveBeenCalledTimes(1);
  });
});
