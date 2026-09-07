import { describe, expect, test } from "vitest";
import { noteFolder, noteLabel, noteStem } from "./note-path";

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

describe("noteFolder", () => {
  test("test_入っているフォルダの相対パス", () => {
    expect(noteFolder("/v", "/v/仕事/会議/議事録.md")).toBe("仕事/会議");
  });
  test("test_直下は空", () => {
    expect(noteFolder("/v", "/v/メモ.md")).toBe("");
  });
});
