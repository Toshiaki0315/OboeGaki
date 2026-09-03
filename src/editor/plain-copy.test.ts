// プレーンテキストコピー（TASKS 2-8、spec §5.4 の Cmd+Shift+C）。
// 期待値は参照実装 core/document.plain_text の実出力（オラクル）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { copyRange, plainTextOf } from "./plain-copy";

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function plain(doc: string, from = 0, to = doc.length): string {
  const state = EditorState.create({ doc, extensions: [LANG] });
  return plainTextOf(state, from, to);
}

describe("plainTextOf", () => {
  test("test_オラクルと同じ出力", () => {
    const doc =
      "# 題\n\n- 項目**強**\n> 引用\n1. 番号\n[説明](https://a.jp) と [[ノート]] と `code`\n";
    expect(plain(doc)).toBe(
      "題\n\n項目強\n引用\n番号\n説明https://a.jp と ノート と code\n",
    );
  });

  test("test_コードは記号ごと残す", () => {
    // コードは記号ごと検索・貼り付けできたほうがよい（参照実装と同じ）
    const doc = "```\nx = **1**\n```\n";
    expect(plain(doc)).toBe(doc);
  });

  test("test_取り消しとハイライトの記号も外れる", () => {
    expect(plain("~~消し~~と::目立つ::")).toBe("消しと目立つ");
  });

  test("test_選択の一部だけを写せる", () => {
    const doc = "前 **強い** 後";
    const from = doc.indexOf("**");
    const to = doc.indexOf(" 後");
    expect(plain(doc, from, to)).toBe("強い");
  });
});

describe("copyRange（選択が無いときの写す範囲）", () => {
  test("test_選択なしはfront_matterを除いた全文", () => {
    // id はアプリの管理情報。他所へ貼る文章に混ぜない（ADR-0013）
    const doc = "---\nid: 01A\n---\n# 本文\n";
    const state = EditorState.create({ doc, extensions: [LANG] });
    expect(copyRange(state)).toEqual([doc.indexOf("# 本文"), doc.length]);
  });

  test("test_選択があればその範囲", () => {
    const doc = "水と油";
    const state = EditorState.create({
      doc,
      selection: { anchor: 1, head: 3 },
      extensions: [LANG],
    });
    expect(copyRange(state)).toEqual([1, 3]);
  });
});
