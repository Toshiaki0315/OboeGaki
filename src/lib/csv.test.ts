// CSV を表にする（要望 2026-09-06）。

import { describe, expect, it } from "vitest";
import { csvToMarkdown, isCsvFile, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("test_素直な行と列", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("test_引用の中の区切りは分けない", () => {
    expect(parseCsv('a,"b,c"\n')).toEqual([["a", "b,c"]]);
  });

  it("test_引用の中の引用は 2 つ重ねる", () => {
    expect(parseCsv('"言った""そう"""\n')).toEqual([['言った"そう"']]);
  });

  it("test_引用の中の改行は 1 つのセルに収める", () => {
    expect(parseCsv('"上\n下",b\n')).toEqual([["上\n下", "b"]]);
  });

  it("test_CRLF も読む（Excel から来る）", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("test_最後の改行が無くても読む", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });

  it("test_空の行は落とす（末尾の空行で行が増えない）", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("test_前後の空白は落とす（引用の中は残す）", () => {
    expect(parseCsv('a , b\n" c ",d\n')).toEqual([
      ["a", "b"],
      [" c ", "d"],
    ]);
  });

  it("test_空文字なら空", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("csvToMarkdown", () => {
  it("test_1 行目を見出しにする", () => {
    expect(
      csvToMarkdown([
        ["名前", "数"],
        ["りんご", "3"],
      ]),
    ).toBe("| 名前 | 数 |\n| --- | --- |\n| りんご | 3 |\n");
  });

  it("test_縦棒は escape する（表が壊れる）", () => {
    expect(csvToMarkdown([["a|b"], ["c"]])).toContain("a\\|b");
  });

  it("test_セルの中の改行は空白にする（1 行に収める）", () => {
    expect(csvToMarkdown([["上\n下"], ["x"]])).toContain("上 下");
  });

  it("test_列の数が揃っていなければ足りないぶんを空で埋める", () => {
    const table = csvToMarkdown([["a", "b", "c"], ["1"]]);
    expect(table).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |\n");
  });

  it("test_多すぎる列は見出しに合わせて増やす（落とさない）", () => {
    const table = csvToMarkdown([["a"], ["1", "2"]]);
    expect(table).toBe("| a |  |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("test_1 行しか無ければ見出しだけの表にする", () => {
    expect(csvToMarkdown([["a", "b"]])).toBe("| a | b |\n| --- | --- |\n");
  });

  it("test_空なら空文字（何も挿さない）", () => {
    expect(csvToMarkdown([])).toBe("");
  });
});

describe("isCsvFile", () => {
  it("test_拡張子で見分ける（大文字も）", () => {
    expect(isCsvFile({ name: "売上.csv" })).toBe(true);
    expect(isCsvFile({ name: "売上.CSV" })).toBe(true);
    expect(isCsvFile({ name: "写真.png" })).toBe(false);
  });

  it("test_種類でも見分ける", () => {
    expect(isCsvFile({ name: "data", type: "text/csv" })).toBe(true);
  });
});
