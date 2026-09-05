// 見出し単位の折りたたみ（TASKS 2-4、ADR-0019）。
// 畳む範囲は純関数。見出しの行末から、同じか浅い見出しの手前まで。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { headingSection } from "./folding";

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [LANG] });
}

function sectionText(doc: string, lineNumber: number): string | null {
  const state = stateOf(doc);
  const line = state.doc.line(lineNumber);
  const range = headingSection(state, line.from);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

const DOC = `# 大見出し
一行目

## 小見出しA
中身A

## 小見出しB
中身B

# 次の大見出し
末尾`;

describe("headingSection", () => {
  test("test_h2は次のh2の手前まで畳む", () => {
    expect(sectionText(DOC, 4)).toBe("\n中身A\n");
  });

  test("test_長いノートの終わりの見出しも畳める", () => {
    // **`syntaxTree` は時間で打ち切られる。** 木が未完成のまま返ると
    // 見出しが見つからず、畳む印がガターから消える（2026-09-05。
    // plain-copy・outline・focusRange と同じ根）
    const filler = Array.from({ length: 3000 }, (_, i) => `行 ${i}`).join("\n");
    const long = `# 頭\n${filler}\n\n## 最後\n中身\n`;
    const lines = long.split("\n").length;
    expect(sectionText(long, lines - 2)).toBe("\n中身\n");
  });

  test("test_h1は配下のh2ごと巻き込む", () => {
    expect(sectionText(DOC, 1)).toBe(
      "\n一行目\n\n## 小見出しA\n中身A\n\n## 小見出しB\n中身B\n",
    );
  });

  test("test_最後の節は文書末まで畳む", () => {
    expect(sectionText(DOC, 10)).toBe("\n末尾");
  });

  test("test_見出しでない行は畳めない", () => {
    expect(sectionText(DOC, 2)).toBeNull();
    expect(sectionText(DOC, 5)).toBeNull();
  });

  test("test_中身が無い見出しは畳めない", () => {
    expect(sectionText("# 見出しだけ", 1)).toBeNull();
  });

  test("test_コードフェンスの中のシャープは見出しではない", () => {
    // 畳む範囲は前の行の行末まで（次見出しの直前の改行は畳みに含めない）
    const doc = "## 節\n```\n# コメント\n```\nあと\n## 次";
    expect(sectionText(doc, 1)).toBe("\n```\n# コメント\n```\nあと");
  });
});
