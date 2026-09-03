// 表のソース整形・挿入・幅計算（TASKS 2-6、参照実装 core/table.py）。

import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  displayWidth,
  formatTable,
  formatTableChange,
  insertTableAt,
  newTable,
  splitCells,
} from "./table-format";

describe("displayWidth", () => {
  test.each([
    ["半角のみ", "abc", 3],
    ["全角は2桁", "日本語", 6],
    ["混在", "列A", 3],
    ["かな", "ぱぴぷ", 6],
    ["エスケープしたパイプは1桁", "a\\|b", 3],
  ])("test_%s", (_label, text, width) => {
    expect(displayWidth(text)).toBe(width);
  });
});

describe("splitCells", () => {
  test("test_エスケープしたパイプは区切りにしない", () => {
    expect(splitCells("a\\|b|c")).toEqual(["a\\|b", "c"]);
  });
});

describe("formatTable", () => {
  test("test_全角混じりで縦線が揃う", () => {
    const lines = ["| 列A | b |", "| --- | --- |", "| 値 | 長い値です |"];
    expect(formatTable(lines)).toEqual([
      "| 列A | b          |",
      "| --- | ---------- |",
      "| 値  | 長い値です |",
    ]);
  });

  test("test_列数が足りない行は空セルで埋め多い行は残す", () => {
    // 期待値は参照実装 format_table の実出力（オラクル）
    const lines = ["| a | b |", "| --- |", "| 1 | 2 | 3 |"];
    expect(formatTable(lines)).toEqual([
      "| a | b |   |",
      "| - | - | - |",
      "| 1 | 2 | 3 |",
    ]);
  });

  test("test_揃え記号を保つ", () => {
    // 期待値は参照実装 format_table の実出力（オラクル）
    const lines = ["| a | b | c |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"];
    expect(formatTable(lines)).toEqual([
      "| a | b | c |",
      "| :- | :-: | -: |",
      "| 1 | 2 | 3 |",
    ]);
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
  const doc = "前\n\n| 列A | b |\n| --- | --- |\n| 値 | 長い値です |\n\n後";

  test("test_崩れた表の置き換えを作る", () => {
    const state = EditorState.create({ doc, extensions: [LANG] });
    const from = doc.indexOf("| 列A");
    const to = doc.indexOf("です |") + 4;
    const change = formatTableChange(state, { from, to });
    expect(change).not.toBeNull();
    expect(change!.insert).toContain("| 列A | b          |");
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
