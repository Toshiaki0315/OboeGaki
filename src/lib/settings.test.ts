// 環境設定（TASKS 3-9）。置き場は 1-1 / 1-5 と同じ localStorage。

import { describe, expect, it } from "vitest";
import {
  clampPaneWidth,
  contentWidthCss,
  DEFAULT_SETTINGS,
  HISTORY_CHOICES,
  loadSettings,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  resolveTheme,
  saveSettings,
  SETTINGS_KEY,
} from "./settings";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("loadSettings", () => {
  it("test_記憶が無ければ既定", () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("test_保存した値を読み戻す", () => {
    const storage = fakeStorage();
    const mine = {
      ...DEFAULT_SETTINGS,
      theme: "dark" as const,
      contentWidth: "wide" as const,
      historyMinutes: 15,
      trashDays: 7,
      listWidth: 300,
      notesVisible: false,
    };
    saveSettings(storage, mine);
    expect(loadSettings(storage)).toEqual(mine);
  });

  it("test_ペインの幅は範囲に丸める", () => {
    // 幅は丸めてよい（狭すぎ・広すぎは見た目の問題で、失うものが無い）
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, listWidth: 10 });
    expect(loadSettings(storage).listWidth).toBe(MIN_PANE_WIDTH);
    saveSettings(storage, { ...DEFAULT_SETTINGS, listWidth: 9999 });
    expect(loadSettings(storage).listWidth).toBe(MAX_PANE_WIDTH);
    expect(clampPaneWidth(Number.NaN)).toBe(DEFAULT_SETTINGS.listWidth);
  });

  it("test_ペインの開閉は真偽値として読む", () => {
    const storage = fakeStorage({
      [SETTINGS_KEY]: '{"notesVisible":"はい","treesVisible":false}',
    });
    const found = loadSettings(storage);
    expect(found.notesVisible).toBe(DEFAULT_SETTINGS.notesVisible);
    expect(found.treesVisible).toBe(false);
  });

  it("test_壊れた値は既定へ落とす", () => {
    // 設定ファイルは手で編集できる。読めない値でアプリを止めない
    const storage = fakeStorage({
      [SETTINGS_KEY]:
        '{"theme":"虹","contentWidth":9,"historyMinutes":7,"trashDays":-3}',
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("test_壊れた JSON でも既定で開く", () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: "{ではない" });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("test_ゴミ箱の日数が範囲の外なら既定へ", () => {
    // **小さい側へ丸めない。** 壊れた値が「1 日で消す」という取り返しの
    // つかない設定に化ける
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, trashDays: 9999 });
    expect(loadSettings(storage).trashDays).toBe(DEFAULT_SETTINGS.trashDays);
    saveSettings(storage, { ...DEFAULT_SETTINGS, trashDays: 0 });
    expect(loadSettings(storage).trashDays).toBe(DEFAULT_SETTINGS.trashDays);
  });

  it("test_履歴の間隔は選べる値だけ", () => {
    // 「なし」（0）も選べる。自分で保存したときだけ残す
    expect(HISTORY_CHOICES).toContain(0);
    expect(HISTORY_CHOICES).toContain(DEFAULT_SETTINGS.historyMinutes);
  });
});

describe("resolveTheme", () => {
  it("test_システムなら今の見た目に従う", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("test_手で選んだらそちらが勝つ", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("contentWidthCss", () => {
  it("test_名前を幅に写す。最大は制限なし", () => {
    expect(contentWidthCss("standard")).toBe("46rem");
    expect(contentWidthCss("wide")).toBe("56rem");
    // 0 ではなく none。CSS の max-width にそのまま渡せる形で持つ
    expect(contentWidthCss("full")).toBe("none");
  });
});
