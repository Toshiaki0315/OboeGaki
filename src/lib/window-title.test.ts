import { describe, expect, test } from "vitest";
import { windowTitle } from "./window-title";

// タイトルバーに文書の題名を出す（要望 2026-09-10）
describe("windowTitle", () => {
  test("test_ノートを開いていれば「題名 — おぼえがき」", () => {
    expect(windowTitle("/v/仕事/会議メモ.md")).toBe("会議メモ — おぼえがき");
  });
  test("test_開いていなければアプリ名だけ", () => {
    expect(windowTitle(null)).toBe("おぼえがき");
  });
});
