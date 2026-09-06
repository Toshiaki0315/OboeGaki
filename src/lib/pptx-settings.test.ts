// PowerPoint の設定（TASKS 8-1 / 仕様 Phase A）。
// **設定全体を初期化しない**のが肝（ST-03）。

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PPTX_SETTINGS,
  loadPptxSettings,
  PPTX_SETTINGS_KEY,
  resetPptxSettings,
  savePptxSettings,
  hexColor,
  isThemeRef,
  readPptxSettings,
  themeRef,
  type PptxSettings,
} from "./pptx-settings";

describe("CFG-90 / ST-02 版", () => {
  it("test_既定は version 1", () => {
    expect(DEFAULT_PPTX_SETTINGS.version).toBe(1);
  });

  it("test_既定は仕様の付録 A のとおり", () => {
    expect(DEFAULT_PPTX_SETTINGS.page.preset).toBe("16:9");
    expect(DEFAULT_PPTX_SETTINGS.layout.splitLevel).toBe(2);
    expect(DEFAULT_PPTX_SETTINGS.layout.maxBulletItems).toBe(6);
    expect(DEFAULT_PPTX_SETTINGS.layout.continuationSuffix).toBe("（続き）");
    expect(DEFAULT_PPTX_SETTINGS.footer.pageNumber).toBe(true);
    expect(DEFAULT_PPTX_SETTINGS.notes.keepOriginalText).toBe(true);
    expect(DEFAULT_PPTX_SETTINGS.advanced.lintLevel).toBe("warn");
  });

  it("test_ADR_0046_既定の色はテーマに従う", () => {
    // 触っていない色は PowerPoint 側のテーマに追従させる（決定 3）
    expect(isThemeRef(DEFAULT_PPTX_SETTINGS.theme.palette.primary)).toBe(true);
  });
});

describe("ST-03 読み込みの立て直し", () => {
  it("test_欠けている項目は既定で補う（全体を初期化しない）", () => {
    const found = readPptxSettings({
      version: 1,
      layout: { maxBulletItems: 9 },
    });
    expect(found.layout.maxBulletItems).toBe(9); // 生きているものは残す
    expect(found.layout.splitLevel).toBe(2); // 欠けたものは既定
    expect(found.footer.pageNumber).toBe(true);
  });

  it("test_型の壊れた値だけを既定に戻す", () => {
    const found = readPptxSettings({
      version: 1,
      page: { preset: "とてもおおきい" },
      layout: { maxBulletItems: "たくさん", continuationSuffix: "（つづき）" },
    });
    expect(found.page.preset).toBe("16:9");
    expect(found.layout.maxBulletItems).toBe(6);
    expect(found.layout.continuationSuffix).toBe("（つづき）"); // 生きている
  });

  it("test_知らない項目は捨てずに残す（新しい版で書いた設定を壊さない）", () => {
    const found = readPptxSettings({ version: 1, page: { future: 1 } });
    expect((found.page as unknown as { future: number }).future).toBe(1);
  });

  it("test_設定が無い・壊れているときは既定一式", () => {
    expect(readPptxSettings(null)).toEqual(DEFAULT_PPTX_SETTINGS);
    expect(readPptxSettings("こわれた")).toEqual(DEFAULT_PPTX_SETTINGS);
    expect(readPptxSettings({ version: "いち" })).toEqual(
      DEFAULT_PPTX_SETTINGS,
    );
  });

  it("test_知らない新しい版は既定に落とす（読めないものを混ぜない）", () => {
    expect(readPptxSettings({ version: 99, page: { preset: "4:3" } })).toEqual(
      DEFAULT_PPTX_SETTINGS,
    );
  });
});

describe("CFG-04 用紙の値", () => {
  const custom = (w: number, h: number): unknown => ({
    version: 1,
    page: { preset: "custom", customWidthIn: w, customHeightIn: h },
  });

  it("test_範囲の中なら残す", () => {
    expect(readPptxSettings(custom(20, 10)).page.customWidthIn).toBe(20);
  });

  it("test_1.0〜56.0in の外は既定に戻す", () => {
    expect(readPptxSettings(custom(0.5, 7.5)).page.customWidthIn).toBe(13.333);
    expect(readPptxSettings(custom(60, 7.5)).page.customWidthIn).toBe(13.333);
  });

  it("test_片辺が他辺の 4 倍を超えたら既定に戻す", () => {
    const found = readPptxSettings(custom(50, 5));
    expect(found.page.customWidthIn).toBe(13.333);
    expect(found.page.customHeightIn).toBe(7.5);
  });
});

describe("CFG-17 色の形", () => {
  it("test_`#` を落として 6 桁にする", () => {
    expect(hexColor("#1E2761")).toEqual({ hex: "1E2761" });
  });

  it("test_8 桁は 6 桁に切る（pptxgenjs が壊れる）", () => {
    expect(hexColor("#1E2761FF")).toEqual({ hex: "1E2761" });
  });

  it("test_小文字は大文字に揃える", () => {
    expect(hexColor("1e2761")).toEqual({ hex: "1E2761" });
  });

  it("test_3 桁は伸ばす", () => {
    expect(hexColor("#abc")).toEqual({ hex: "AABBCC" });
  });

  it("test_色でなければ null", () => {
    expect(hexColor("あか")).toBeNull();
    expect(hexColor("#12345")).toBeNull();
  });

  it("test_テーマ参照はそのまま持てる", () => {
    expect(isThemeRef(themeRef("accent1"))).toBe(true);
    expect(isThemeRef({ hex: "1E2761" })).toBe(false);
  });

  it("test_読み込みでも色は正規化する", () => {
    const found = readPptxSettings({
      version: 1,
      theme: { palette: { background: "#ffffff" } },
    });
    expect(found.theme.palette.background).toEqual({ hex: "FFFFFF" });
  });

  it("test_色でない値は既定に戻す（壊れた色で書き出さない）", () => {
    const found = readPptxSettings({
      version: 1,
      theme: { palette: { background: "まっしろ" } },
    });
    expect(found.theme.palette.background).toEqual(
      DEFAULT_PPTX_SETTINGS.theme.palette.background,
    );
  });
});

describe("SC-01 保存と読み戻し", () => {
  it("test_書いたものがそのまま戻る", () => {
    const mine: PptxSettings = {
      ...DEFAULT_PPTX_SETTINGS,
      page: { ...DEFAULT_PPTX_SETTINGS.page, preset: "4:3" },
      footer: { pageNumber: false, text: "社外秘", showDate: true },
    };
    expect(readPptxSettings(JSON.parse(JSON.stringify(mine)))).toEqual(mine);
  });
});

function fakeStorage() {
  const bag = new Map<string, string>();
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => void bag.set(key, value),
    removeItem: (key: string) => void bag.delete(key),
  };
}

describe("ST-01 置き場（SettingsStore）", () => {
  it("test_書いて読み戻せる", () => {
    const storage = fakeStorage();
    const mine = {
      ...DEFAULT_PPTX_SETTINGS,
      footer: { pageNumber: false, text: "社外秘", showDate: false },
    };
    savePptxSettings(storage, mine);
    expect(loadPptxSettings(storage)).toEqual(mine);
  });

  it("test_何も無ければ既定", () => {
    expect(loadPptxSettings(fakeStorage())).toEqual(DEFAULT_PPTX_SETTINGS);
  });

  it("test_壊れた JSON でも既定で立ち上がる", () => {
    const storage = fakeStorage();
    storage.setItem(PPTX_SETTINGS_KEY, "{こわれている");
    expect(loadPptxSettings(storage)).toEqual(DEFAULT_PPTX_SETTINGS);
  });

  it("test_既定に戻すと記録ごと消える", () => {
    const storage = fakeStorage();
    savePptxSettings(storage, {
      ...DEFAULT_PPTX_SETTINGS,
      advanced: { lintLevel: "strict", reproducible: true },
    });
    resetPptxSettings(storage);
    expect(loadPptxSettings(storage)).toEqual(DEFAULT_PPTX_SETTINGS);
  });

  it("test_置き場が使えなくても落ちない（読めない・書けない）", () => {
    const broken = {
      getItem: () => {
        throw new Error("だめ");
      },
      setItem: () => {
        throw new Error("だめ");
      },
      removeItem: () => {
        throw new Error("だめ");
      },
    };
    expect(loadPptxSettings(broken)).toEqual(DEFAULT_PPTX_SETTINGS);
    expect(() => savePptxSettings(broken, DEFAULT_PPTX_SETTINGS)).not.toThrow();
    expect(() => resetPptxSettings(broken)).not.toThrow();
  });
});
