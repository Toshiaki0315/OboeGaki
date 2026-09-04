// 表のソース整形・挿入・幅計算（TASKS 2-6、参照実装 core/table.py）。

import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  formatTable,
  formatTableChange,
  insertTableAt,
  newTable,
  splitCells,
} from "./table-format";

describe("splitCells", () => {
  test("test_エスケープしたパイプは区切りにしない", () => {
    expect(splitCells("a\\|b|c")).toEqual(["a\\|b", "c"]);
  });
});

describe("formatTable", () => {
  test("test_桁は揃えない_区切りを整えるだけ", () => {
    // **文字の幅で揃えない**（ADR-0044）。揃うかどうかは表示に使う
    // フォント次第で、こちらからは決められない
    const lines = ["|列A|b|", "| --- | --- |", "|  値   | 長い値です|"];
    expect(formatTable(lines)).toEqual([
      "| 列A | b |",
      "| --- | --- |",
      "| 値 | 長い値です |",
    ]);
  });

  test("test_空のセルも形を保つ", () => {
    const lines = ["| a | b |", "| --- | --- |", "| | 2 |"];
    expect(formatTable(lines)).toEqual([
      "| a | b |",
      "| --- | --- |",
      "|  | 2 |",
    ]);
  });

  test("test_列数が足りない行は空セルで埋め多い行は残す", () => {
    // 期待値は参照実装 format_table の実出力（オラクル）
    const lines = ["| a | b |", "| --- |", "| 1 | 2 | 3 |"];
    expect(formatTable(lines)).toEqual([
      "| a | b |  |",
      "| --- | --- | --- |",
      "| 1 | 2 | 3 |",
    ]);
  });

  test("test_揃え記号を保つ", () => {
    // 期待値は参照実装 format_table の実出力（オラクル）
    const lines = ["| a | b | c |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"];
    expect(formatTable(lines)).toEqual([
      "| a | b | c |",
      "| :-- | :-: | --: |",
      "| 1 | 2 | 3 |",
    ]);
  });

  test("test_二度整えても変わらない", () => {
    // 表を離れるたびに走るので、変わり続けると保存が止まらなくなる
    const once = formatTable(["|列A|b|", "|-|--|", "|  値 |長い値です|"])!;
    expect(formatTable(once)).toEqual(once);
  });

  test("test_区切り行が無ければ表ではない", () => {
    expect(formatTable(["| a | b |", "| 1 | 2 |"])).toBeNull();
    expect(formatTable(["| a |"])).toBeNull();
  });
});

describe("newTable", () => {
  test("test_見出しの目印入りで整形済み", () => {
    const lines = newTable(2, 2);
    expect(lines[0]).toContain("見出し1");
    expect(lines[0]).toContain("見出し2");
    expect(lines).toHaveLength(4); // 見出し + 区切り + 本体 2 行
    expect(formatTable(lines)).toEqual(lines); // 既に整形済み
  });
});

describe("insertTableAt", () => {
  test("test_段落の途中なら空行を挟んでから置く", () => {
    const text = "本文";
    const r = insertTableAt(text, 2, 2, { rows: 1, columns: 2 });
    expect(r.text.startsWith("\n\n| 見出し1")).toBe(true);
    expect(r.text.endsWith("|\n\n")).toBe(true);
    // 最初の見出しが選ばれていて、打てばそのまま置き換わる
    expect((text.slice(0, 2) + r.text).slice(r.selectStart, r.selectEnd)).toBe(
      "見出し1",
    );
  });

  test("test_選択があっても消さない", () => {
    const text = "選んだ文字";
    const r = insertTableAt(text, 0, 3, { rows: 1, columns: 1 });
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });
});

// --- 表を離れたときの整形（formatTableChange） ---

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

describe("formatTableChange", () => {
  // 区切りが揃っていない・空白が余っている表（＝整える対象）
  const doc = "前\n\n|列A|b|\n|-|----|\n|  値 |長い値です|\n\n後";

  test("test_崩れた表の置き換えを作る", () => {
    const state = EditorState.create({ doc, extensions: [LANG] });
    const from = doc.indexOf("|列A");
    const to = doc.indexOf("長い値です|") + 6;
    const change = formatTableChange(state, { from, to });
    expect(change).not.toBeNull();
    expect(change!.insert).toBe(
      "| 列A | b |\n| --- | --- |\n| 値 | 長い値です |",
    );
  });

  test("test_既に揃っている表には何もしない", () => {
    const formatted = formatTable([
      "| 列A | b |",
      "| --- | --- |",
      "| 値 | 長い値です |",
    ])!.join("\n");
    const state = EditorState.create({
      doc: formatted,
      extensions: [LANG],
      selection: EditorSelection.cursor(0),
    });
    expect(
      formatTableChange(state, { from: 0, to: formatted.length }),
    ).toBeNull();
  });
});
