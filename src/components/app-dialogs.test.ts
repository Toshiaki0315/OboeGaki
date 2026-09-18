// 今開いているダイアログ（20-2）。名前を 1 つ聞く窓 5 種の字面を見る。
// 押したあとに何が起きるかは App。

import { describe, expect, test } from "vitest";
import { isPrompt, promptSpec, type OpenDialog } from "./app-dialogs";

describe("app-dialogs", () => {
  test("test_名前を聞く窓だけが_isPrompt", () => {
    const prompts: OpenDialog[] = [
      { kind: "day", date: "2026-09-18" },
      { kind: "tag", tag: "旅" },
      { kind: "folder", mode: "create", folder: "" },
      { kind: "saveSearch", query: "tag:旅" },
      { kind: "template", path: "/v/a.md" },
    ];
    const others: OpenDialog[] = [
      { kind: "quickOpen" },
      { kind: "table" },
      { kind: "preferences" },
      { kind: "move", path: null },
      { kind: "headings", items: [] },
      { kind: "templates", paths: [] },
      { kind: "styleCheck", findings: [] },
      { kind: "graph", svg: "", dropped: 0, depth: 2 },
      { kind: "history", entries: [], base: "" },
    ];
    expect(prompts.every(isPrompt)).toBe(true);
    expect(others.some(isPrompt)).toBe(false);
  });

  test("test_日付は_date_型で今日が既定", () => {
    const spec = promptSpec({ kind: "day", date: "2026-09-18" });
    expect(spec.type).toBe("date");
    expect(spec.defaultValue).toBe("2026-09-18");
    expect(spec.confirmLabel).toBe("開く");
  });

  test("test_タグは今の名前が既定で_統合の断りが添う", () => {
    const spec = promptSpec({ kind: "tag", tag: "旅" });
    expect(spec.title).toBe("タグ「#旅」の名前を変更");
    expect(spec.defaultValue).toBe("旅");
    expect(spec.note).toMatch(/統合/);
  });

  test("test_フォルダの作成は親で題が変わり_改名は今の名前が既定", () => {
    expect(
      promptSpec({ kind: "folder", mode: "create", folder: "" }).title,
    ).toBe("新しいフォルダ");
    expect(
      promptSpec({ kind: "folder", mode: "create", folder: "日記" }).title,
    ).toBe("「日記」の中に新しいフォルダ");
    const rename = promptSpec({
      kind: "folder",
      mode: "rename",
      folder: "日記/2026",
    });
    expect(rename.title).toBe("「日記/2026」の名前を変更");
    expect(rename.defaultValue).toBe("2026");
  });

  test("test_検索の保存は式そのものが既定で_式を添える", () => {
    const spec = promptSpec({ kind: "saveSearch", query: "tag:旅" });
    expect(spec.defaultValue).toBe("tag:旅");
    expect(spec.note).toBe("検索式: tag:旅");
  });

  test("test_テンプレートの登録は題名の幹が既定", () => {
    const spec = promptSpec({ kind: "template", path: "/v/日記/あ.md" });
    expect(spec.defaultValue).toBe("あ");
    expect(spec.confirmLabel).toBe("登録");
  });
});
