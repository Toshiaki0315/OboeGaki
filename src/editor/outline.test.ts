// アウトライン（ADR-0022）の見出し抽出。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { outlineOf } from "./outline";

function outline(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
  return outlineOf(state);
}

describe("outlineOf", () => {
  test("見出しをレベルと位置つきで順に返す", () => {
    const doc = "# 題\n\n本文\n\n## 節\n\n### 小節\n";
    expect(outline(doc)).toEqual([
      { level: 1, text: "題", from: 0 },
      { level: 2, text: "節", from: doc.indexOf("## 節") },
      { level: 3, text: "小節", from: doc.indexOf("### 小節") },
    ]);
  });

  test("コードフェンスの中の # は拾わない", () => {
    const doc = "# 本物\n\n```\n# コメント\n```\n";
    expect(outline(doc).map((i) => i.text)).toEqual(["本物"]);
  });

  test("見出しの中のマーカーは落とさず生のまま返す", () => {
    const doc = "## **強調**入り\n";
    expect(outline(doc)[0].text).toBe("**強調**入り");
  });

  test("見出しが無ければ空", () => {
    expect(outline("ただの本文\n")).toEqual([]);
  });
});
