import { describe, expect, test } from "vitest";
import { noteLabel, noteStem } from "./note-path";

describe("noteStem", () => {
  test("test_フォルダと拡張子を外した幹", () => {
    expect(noteStem("/v/仕事/会議.md")).toBe("会議");
    expect(noteStem("/v/a.markdown")).toBe("a");
  });
  test("test_大文字の拡張子も外す", () => {
    expect(noteStem("/v/A.MD")).toBe("A");
  });
});

describe("noteLabel", () => {
  test("test_保管フォルダからの相対で_フォルダは残す", () => {
    expect(noteLabel("/v", "/v/仕事/会議.md")).toBe("仕事/会議");
  });
  test("test_保管フォルダの外はそのまま", () => {
    expect(noteLabel("/v", "/elsewhere/x.md")).toBe("/elsewhere/x");
  });
});
