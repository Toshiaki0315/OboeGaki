// @vitest-environment jsdom
// 環境設定・文字サイズ・PowerPoint の設定（19-4 で App.tsx から切り出した）。
// 変えたらすぐ効いて覚える、既定に戻すのはダイアログの項目だけ、を見る

import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DEFAULT_FONT_PX } from "../lib/font-size";
import { DEFAULT_PPTX_SETTINGS } from "../lib/pptx-settings";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { usePreferences } from "./usePreferences";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("usePreferences", () => {
  test("test_設定を変えるとすぐ効いて_同じ置き場から読み直せる", () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => usePreferences(storage));
    act(() => result.current.changeSettings({ tabWidth: 8, listWidth: 300 }));
    expect(result.current.settings.tabWidth).toBe(8);
    const again = renderHook(() => usePreferences(storage));
    expect(again.result.current.settings.tabWidth).toBe(8);
    expect(again.result.current.settings.listWidth).toBe(300);
  });

  test("test_既定に戻すのはダイアログの項目だけ_ペイン幅と開閉は触らない", () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => usePreferences(storage));
    act(() => {
      result.current.changeSettings({ tabWidth: 8, listWidth: 300 });
      result.current.changeFontSize(DEFAULT_FONT_PX + 4);
    });
    act(() => result.current.resetPreferences());
    expect(result.current.settings.tabWidth).toBe(DEFAULT_SETTINGS.tabWidth);
    expect(result.current.settings.listWidth).toBe(300);
    expect(result.current.fontSize).toBe(DEFAULT_FONT_PX);
  });

  test("test_PowerPoint_の設定は別の鍵で覚え_既定に戻せる", () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => usePreferences(storage));
    act(() =>
      result.current.changePptxSettings({
        layout: { ...DEFAULT_PPTX_SETTINGS.layout, splitLevel: 3 },
      }),
    );
    expect(result.current.pptxSettings.layout.splitLevel).toBe(3);
    expect(
      renderHook(() => usePreferences(storage)).result.current.pptxSettings
        .layout.splitLevel,
    ).toBe(3);
    act(() => result.current.resetPptxSettings());
    expect(result.current.pptxSettings).toEqual(DEFAULT_PPTX_SETTINGS);
  });
});
