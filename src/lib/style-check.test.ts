// 日本語の文体を見る（TASKS 4-11 / U-4）。
// **指摘するだけで、直さない**（書き手の言葉を機械が上書きしない）。

import { describe, expect, test } from "vitest";
import { checkStyle, MAX_SENTENCE } from "./style-check";

const kinds = (text: string) => checkStyle(text).map((found) => found.kind);
const messages = (text: string) =>
  checkStyle(text).map((found) => found.message);

describe("checkStyle", () => {
  test("冗長な言い回しを指摘し、どう書けるかを出す", () => {
    // 何が悪いかだけ言われても動けない
    const found = checkStyle("ここで設定することができます。");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("redundant");
    expect(found[0].message).toContain("できます");
    // 位置は本文の先頭から数える（押せば飛べるように）
    expect(found[0].start).toBe("ここで設定".length);
  });

  test("**否定は否定で言い換える**（意味が逆になる言い換えは指摘より悪い）", () => {
    expect(messages("設定することができません。")[0]).toContain("できません");
  });

  test("二重否定・重ね言葉を拾う", () => {
    expect(kinds("できなくはない。")).toEqual(["double-negative"]);
    expect(kinds("まず最初に確認する。")).toEqual(["tautology"]);
    expect(kinds("違和感を感じた。")).toEqual(["tautology"]);
  });

  test("`の` が続いたら指摘する", () => {
    expect(kinds("私の友人の家の庭。")).toEqual(["particle-run"]);
  });

  test("2 つの `の` は指摘しない（ふつうに書く）", () => {
    expect(checkStyle("私の友人の家。")).toEqual([]);
  });

  test("**こそあどは数えない**（連体詞の一部で、連なりではない）", () => {
    expect(checkStyle("前の行の字下げがそのまま続きます。")).toEqual([]);
  });

  test("長い 1 文だけを指摘する（**厳しくしない**）", () => {
    const long = `${"あ".repeat(MAX_SENTENCE + 5)}。`;
    expect(kinds(long)).toEqual(["long-sentence"]);
    const fine = `${"あ".repeat(MAX_SENTENCE - 10)}。`;
    expect(checkStyle(fine)).toEqual([]);
  });

  test("短い文が並んでいるだけなら指摘しない（行の長さでは数えない）", () => {
    const line = "短い文です。".repeat(30);
    expect(checkStyle(line)).toEqual([]);
  });

  test("**表と区切り線は文として数えない**（直しようがない）", () => {
    const table = "| --- | ---- |\n| " + "あ".repeat(120) + " | x |\n";
    expect(checkStyle(table)).toEqual([]);
  });

  test("コードの中は見ない（コード例の日本語は文章ではない）", () => {
    const code = "```\nここで設定することができます。\n```\n";
    expect(checkStyle(code)).toEqual([]);
  });

  test("front matter は見ない（アプリの管理情報）", () => {
    const text = "---\nnote: することができます\n---\n本文。\n";
    expect(checkStyle(text)).toEqual([]);
  });

  test("位置の順に並べる", () => {
    const text = "まず最初に確認する。ここで設定することができます。";
    const found = checkStyle(text);
    expect(found).toHaveLength(2);
    expect(found[0].start).toBeLessThan(found[1].start);
  });
});
