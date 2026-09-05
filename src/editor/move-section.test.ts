// 節ごと動かす（TASKS 7-1、ポメラのアウトライン相当）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { moveSection } from "./move-section";

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function moved(doc: string, headingText: string, delta: -1 | 1) {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const move = moveSection(state, doc.indexOf(headingText), delta);
  if (!move) return null;
  const after = state.update({ changes: move.changes }).state;
  // 動かした先に見出しがあること（キャレットの置き先が合っている）
  expect(after.doc.sliceString(move.headingAt, move.headingAt + 2)).toContain(
    "#",
  );
  return after.doc.toString();
}

const DOC = `# 題

前書き

## A

あああ

## B

いいい

## C

ううう
`;

describe("moveSection", () => {
  test("test_節を下へ動かすと、次の節と入れ替わる", () => {
    const after = moved(DOC, "## A", 1);
    expect(after).toBe(`# 題

前書き

## B

いいい

## A

あああ

## C

ううう
`);
  });

  test("test_節を上へ動かすと、前の節と入れ替わる", () => {
    expect(moved(DOC, "## C", -1)).toBe(`# 題

前書き

## A

あああ

## C

ううう

## B

いいい
`);
  });

  test("test_深い見出しは配下ごと動く", () => {
    const nested = `## A

あ

### A-1

い

## B

う
`;
    expect(moved(nested, "## A", 1)).toBe(`## B

う

## A

あ

### A-1

い
`);
  });

  test("test_浅い見出しの手前を越えない", () => {
    // `### A-1` を上げても `## A` より前には出さない（親から飛び出さない）
    const nested = `## A

あ

### A-1

い
`;
    expect(moved(nested, "### A-1", -1)).toBeNull();
  });

  test("test_端では動かさない", () => {
    expect(moved(DOC, "## C", 1)).toBeNull();
    expect(moved(DOC, "# 題", -1)).toBeNull();
  });

  test("test_見出しの位置でなければ動かさない", () => {
    expect(moved(DOC, "前書き", 1)).toBeNull();
  });

  test("test_最後の節を動かしても文末の改行が消えない", () => {
    const two = `## A\n\nあ\n\n## B\n\nい\n`;
    expect(moved(two, "## A", 1)).toBe(`## B\n\nい\n\n## A\n\nあ\n`);
  });
});
