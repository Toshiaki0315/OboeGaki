// 文字数と行数（TASKS 3-10、参照実装 core/stats.py の移植）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { countText, sheets, statsOf } from "./stats";

function stats(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
  return statsOf(state);
}

describe("countText", () => {
  test("改行は数えない。空白は数える", () => {
    expect(countText("あい うえ\nお")).toEqual({ characters: 6, lines: 2 });
  });

  test("空の本文は 0 行", () => {
    expect(countText("")).toEqual({ characters: 0, lines: 0 });
    expect(countText("\n\n  \n")).toEqual({ characters: 2, lines: 0 });
  });

  test("末尾の改行で行が増えない", () => {
    expect(countText("一行目\n").lines).toBe(1);
    expect(countText("一行目\n二行目\n").lines).toBe(2);
  });

  test("絵文字は 1 文字と数える（見た目の 1 文字）", () => {
    // JS の length は UTF-16 単位なのでサロゲートペアが 2 になる
    expect(countText("😀").characters).toBe(1);
  });
});

describe("statsOf", () => {
  test("マーカーは分量に含めない", () => {
    // `**` や `#` は読む文章の一部ではない
    expect(statsOf(EditorState.create({ doc: "" })).characters).toBe(0);
    expect(stats("# 見出し").characters).toBe(3);
    expect(stats("**強調**です").characters).toBe(4); // 強調です
  });

  test("front matter は数えない（アプリの管理情報）", () => {
    const doc = "---\npinned: true\n---\n本文です\n";
    expect(stats(doc)).toEqual({ characters: 4, lines: 1 });
  });

  test("コードは記号ごと数える（記号もコードの一部）", () => {
    const doc = "```js\nlet a = 1;\n```\n";
    expect(stats(doc).lines).toBe(3);
  });
});

describe("sheets", () => {
  test("test_400 字で 1 枚（原稿用紙の数え方）", () => {
    expect(sheets(400)).toBe("1");
    expect(sheets(800)).toBe("2");
  });

  test("test_端数は小数第 1 位まで（切り上げない）", () => {
    // 「あと少しで 2 枚」が見えるほうが、書く手が進む
    expect(sheets(600)).toBe("1.5");
    expect(sheets(444)).toBe("1.1");
  });

  test("test_1 枚に満たなければ null（枚数を出さない）", () => {
    // 0.2 枚と言われても分からない。1 枚を超えてから出す
    expect(sheets(399)).toBeNull();
    expect(sheets(0)).toBeNull();
  });
});
