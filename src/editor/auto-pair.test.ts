import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  AUTO_PAIRS,
  isUrl,
  linkifyPaste,
  wrapPair,
  wrapSelections,
} from "./auto-pair";

describe("wrapPair", () => {
  it.each(Object.entries(AUTO_PAIRS))(
    "test_選択を%sで囲んで中身を選び直す",
    (opening, closing) => {
      const result = wrapPair("水と油", 0, 1, opening);
      expect(result).not.toBeNull();
      expect(result?.text).toBe(`${opening}水${closing}`);
      // 続けて * を押せば強調を二重にできるよう、中身を選んだままにする
      expect(result?.selectStart).toBe(opening.length);
      expect(result?.selectEnd).toBe(opening.length + 1);
    },
  );

  it("test_選択が無ければ何もしない", () => {
    expect(wrapPair("水と油", 2, 2, "*")).toBeNull();
  });

  it("test_対の無い文字は何もしない", () => {
    expect(wrapPair("水と油", 0, 1, "#")).toBeNull();
    expect(wrapPair("水と油", 0, 1, "a")).toBeNull();
  });

  it("test_絵文字の選択も右端が欠けない", () => {
    // JS の文字列は UTF-16。サロゲートペアで長さが揃うことを確かめる
    const result = wrapPair("🎉祭り", 0, 3, "*");
    expect(result?.text).toBe("*🎉祭*");
    expect(result?.selectEnd).toBe(1 + 3);
  });
});

describe("wrapSelections", () => {
  it("test_選択ありの状態から強調で囲むtransactionを作る", () => {
    const state = EditorState.create({
      doc: "水と油",
      selection: EditorSelection.range(0, 1),
    });
    const spec = wrapSelections(state, "*");
    expect(spec).not.toBeNull();
    const next = state.update(spec!);
    expect(next.state.doc.toString()).toBe("*水*と油");
    expect(next.state.selection.main.from).toBe(1);
    expect(next.state.selection.main.to).toBe(2);
  });

  it("test_選択が空ならnullで既定の入力に任せる", () => {
    const state = EditorState.create({ doc: "水と油" });
    expect(wrapSelections(state, "*")).toBeNull();
  });
});

describe("isUrl", () => {
  it.each([
    ["https", "https://example.com/a?b=c", true],
    ["http", "http://例え.jp", true],
    ["前後の空白は許す", "  https://example.com  ", true],
    ["独自スキーム", "obsidian://open?vault=x", true],
    ["スキームなし", "www.example.com", false],
    ["ただの文", "水と油 https://example.com", false],
    ["空", "", false],
  ])("test_%s", (_label, text, expected) => {
    expect(isUrl(text)).toBe(expected);
  });
});

describe("linkifyPaste", () => {
  it("test_選択があるときにURLを貼るとリンクになる", () => {
    const state = EditorState.create({
      doc: "公式サイトを見る",
      selection: EditorSelection.range(0, 5),
    });
    const spec = linkifyPaste(state, "https://example.com/");
    expect(spec).not.toBeNull();
    const next = state.update(spec!);
    expect(next.state.doc.toString()).toBe(
      "[公式サイト](https://example.com/)を見る",
    );
    // 参照実装 insert_link と同じく、キャレットはリンク全体の後ろ
    expect(next.state.selection.main.from).toBe(
      "[公式サイト](https://example.com/)".length,
    );
  });

  it("test_選択が無ければ何もしない_素のURLが入るのが仕様", () => {
    const state = EditorState.create({ doc: "メモ" });
    expect(linkifyPaste(state, "https://example.com/")).toBeNull();
  });

  it("test_URLでない貼り付けは触らない", () => {
    const state = EditorState.create({
      doc: "公式サイト",
      selection: EditorSelection.range(0, 5),
    });
    expect(linkifyPaste(state, "ただの文")).toBeNull();
  });

  it("test_前後の空白や改行は落としてURLにする", () => {
    const state = EditorState.create({
      doc: "リンク",
      selection: EditorSelection.range(0, 3),
    });
    const next = state.update(linkifyPaste(state, "  https://a.jp\n")!);
    expect(next.state.doc.toString()).toBe("[リンク](https://a.jp)");
  });
});
