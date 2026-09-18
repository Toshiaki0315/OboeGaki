// @vitest-environment jsdom
// メニューバーとの配線（19-4 で App.tsx から切り出した）。印は変わったときに
// 全部まとめて送る、押されたら最新の動作を呼ぶ、画面の中からも同じ動作を呼べる

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  setMenuChecks: vi.fn(),
  subscribeMenu: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import type { MenuChecks } from "../lib/menu-checks";
import { useAppMenu } from "./useAppMenu";

const mocked = vi.mocked(ipc);
const CHECKS: MenuChecks = {
  "toggle-trees": true,
  "toggle-notes": false,
  outline: false,
  assistant: false,
  "inline-mode": true,
  "source-mode": false,
  "preview-mode": false,
  "focus-mode": false,
  typewriter: false,
};

let pressed: ((id: string) => void) | null = null;
beforeEach(() => {
  vi.resetAllMocks();
  mocked.setMenuChecks.mockResolvedValue(undefined);
  mocked.subscribeMenu.mockImplementation((handler) => {
    pressed = handler;
    return () => {};
  });
});

describe("useAppMenu", () => {
  test("test_印は全部まとめて送り_同じ中身なら送り直さない", () => {
    const { rerender } = renderHook(
      (props: { checks: MenuChecks }) =>
        useAppMenu({ checks: props.checks, actions: {} }),
      { initialProps: { checks: CHECKS } },
    );
    expect(mocked.setMenuChecks).toHaveBeenCalledTimes(1);
    expect(mocked.setMenuChecks).toHaveBeenCalledWith(CHECKS);
    rerender({ checks: { ...CHECKS } }); // 新しいオブジェクト、同じ中身
    expect(mocked.setMenuChecks).toHaveBeenCalledTimes(1);
    rerender({ checks: { ...CHECKS, outline: true } });
    expect(mocked.setMenuChecks).toHaveBeenCalledTimes(2);
  });

  test("test_押されたら最新の動作を呼ぶ_知らない_id_は無視", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, result } = renderHook(
      (props: { save: () => void }) =>
        useAppMenu({ checks: CHECKS, actions: { save: props.save } }),
      { initialProps: { save: first } },
    );
    pressed!("save");
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ save: second });
    pressed!("save");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    pressed!("unknown"); // 何も起きない
    result.current.run("save");
    expect(second).toHaveBeenCalledTimes(2);
  });
});
