// 木を待って受け取る（2026-09-05）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { treeOf } from "./parse-tree";

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
}

describe("treeOf", () => {
  test("test_長いノートでも文書の終わりまで届く", () => {
    const filler = Array.from({ length: 3000 }, (_, i) => `行 ${i}`).join("\n");
    const state = stateOf(`# 頭\n\n${filler}\n\n## 最後\n`);
    expect(treeOf(state).length).toBe(state.doc.length);
  });

  test("test_途中までで足りるときは、そこまでで答える", () => {
    const state = stateOf("# 頭\n\n本文\n");
    expect(treeOf(state, 3).length).toBeGreaterThanOrEqual(3);
  });

  test("test_解析済みなら syntaxTree と同じ木", () => {
    const state = stateOf("# 頭\n");
    expect(treeOf(state).length).toBe(syntaxTree(state).length);
  });
});
