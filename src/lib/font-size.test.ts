import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  DEFAULT_FONT_PX,
  loadFontSize,
  MAX_FONT_PX,
  MIN_FONT_PX,
  saveFontSize,
  zoomActionFor,
} from "./font-size";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("clampFontSize", () => {
  it("test_範囲内はそのまま", () => {
    expect(clampFontSize(16)).toBe(16);
  });

  it("test_端では丸める", () => {
    // 押したのに何も起きないより、行けるところまで行くほうが素直
    expect(clampFontSize(MIN_FONT_PX - 5)).toBe(MIN_FONT_PX);
    expect(clampFontSize(MAX_FONT_PX + 5)).toBe(MAX_FONT_PX);
  });

  it("test_数でない値は既定に戻す", () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_PX);
  });
});

describe("loadFontSize / saveFontSize", () => {
  it("test_保存した値を次回読み出せる", () => {
    const storage = fakeStorage();
    saveFontSize(storage, 20);
    expect(loadFontSize(storage)).toBe(20);
  });

  it("test_記憶が無ければ既定値", () => {
    expect(loadFontSize(fakeStorage())).toBe(DEFAULT_FONT_PX);
  });

  it("test_壊れた記憶は既定値に戻す", () => {
    expect(loadFontSize(fakeStorage({ "oboegaki.fontsize": "abc" }))).toBe(
      DEFAULT_FONT_PX,
    );
    expect(loadFontSize(fakeStorage({ "oboegaki.fontsize": "999" }))).toBe(
      MAX_FONT_PX,
    );
  });

  it("test_保存先が壊れていても例外を漏らさない", () => {
    const broken = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() => saveFontSize(broken, 20)).not.toThrow();
    expect(loadFontSize(broken)).toBe(DEFAULT_FONT_PX);
  });
});

describe("zoomActionFor", () => {
  // JIS 実機での報告 2 件の回帰:
  // 1) メニューのアクセラレータが Cmd+; に化けた（→ event.key で判定）
  // 2) Cmd を押している間は Shift を足しても event.key が基底文字のまま
  //    （JIS の Cmd+= は物理的に Cmd+Shift+- だが、key は "-" で届く）
  it.each([
    ["=", false, "in"],
    ["=", true, "in"],
    ["+", false, "in"],
    ["-", true, "in"], // JIS: Shift+- が = なので「大きく」
    [";", true, "in"], // JIS: Shift+; が + なので「大きく」
    ["-", false, "out"],
    ["0", false, "reset"],
  ] as const)("test_キー%s_shift%sで%s", (key, shift, action) => {
    expect(zoomActionFor(key, shift)).toBe(action);
  });

  it("test_関係ないキーはnull", () => {
    expect(zoomActionFor(";", false)).toBeNull();
    expect(zoomActionFor("a", false)).toBeNull();
    expect(zoomActionFor("^", false)).toBeNull();
  });
});
