// 編集モード（インライン／ソース／プレビュー）の巡回と名前（要望 2026-09-15）。
// 右上のボタンは 1 つで 3 つを巡り、今どこかを絵で見せる。

import { describe, expect, test } from "vitest";
import { EDIT_MODE_LABELS, editModeOf, nextEditMode } from "./edit-mode";

describe("editModeOf", () => {
  test("test_どちらも切ならインライン_立っているほうがそのモード", () => {
    expect(editModeOf({ source: false, preview: false })).toBe("inline");
    expect(editModeOf({ source: true, preview: false })).toBe("source");
    expect(editModeOf({ source: false, preview: true })).toBe("preview");
    // 同時に立つことは field の排他で起きないが、来たらソースを優先（全部見せるほうが安全）
    expect(editModeOf({ source: true, preview: true })).toBe("source");
  });
});

describe("nextEditMode", () => {
  test("test_インライン_→_ソース_→_プレビュー_→_インライン_と巡る", () => {
    expect(nextEditMode("inline")).toBe("source");
    expect(nextEditMode("source")).toBe("preview");
    expect(nextEditMode("preview")).toBe("inline");
  });
});

describe("EDIT_MODE_LABELS", () => {
  test("test_メニューと同じ呼び名", () => {
    expect(EDIT_MODE_LABELS).toEqual({
      inline: "インラインモード",
      source: "ソースモード",
      preview: "プレビューモード",
    });
  });
});
