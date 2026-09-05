// フォルダを Finder で開く（要望 2026-09-05）。

import { describe, expect, it } from "vitest";
import { finderTarget, TRASH_FOLDER } from "./finder";

describe("finderTarget", () => {
  it("test_保管フォルダの中のフォルダを指す", () => {
    expect(finderTarget("/v", "仕事/2026")).toBe("/v/仕事/2026");
  });

  it("test_空文字は保管フォルダそのもの", () => {
    expect(finderTarget("/v", "")).toBe("/v");
  });

  it("test_ゴミ箱も同じ道で開ける", () => {
    expect(finderTarget("/v", TRASH_FOLDER)).toBe("/v/.trash");
  });

  it("test_保管フォルダの末尾の / で二重にしない", () => {
    expect(finderTarget("/v/", "仕事")).toBe("/v/仕事");
  });
});
