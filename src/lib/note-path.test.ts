import { describe, expect, test } from "vitest";
import { nfcUnder, noteFolder, noteLabel, noteStem } from "./note-path";

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

describe("nfcUnder", () => {
  test("test_root からの相対部分を NFC に揃え_root は触らない（ADR-0050）", () => {
    // 実機 2026-09-09: 一覧に出ていた NFD の行を開いて終了 → 次の起動で
    // NFD のパスのまま開き、NFC で届く監視イベントと字面が合わず読み直されなかった
    const nfd = "99_テスト/フ\u{309A}ロシ\u{3099}ェクト.md";
    expect(nfcUnder("/v/ノ\u{3099}ート", `/v/ノ\u{3099}ート/${nfd}`)).toBe(
      "/v/ノ\u{3099}ート/99_テスト/プロジェクト.md",
    );
  });
  test("test_root の外はそのまま", () => {
    expect(nfcUnder("/v", "/other/フ\u{309A}.md")).toBe("/other/フ\u{309A}.md");
  });
});
