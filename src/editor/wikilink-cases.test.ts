// ノートリンクの名前の拾い方を、Rust 側と**同じ見本**で突き合わせる
// （fixtures/wikilink-cases.json。TASKS 15-5）。
//
// 規則は 2 か所にある — CM6 のパーサ（ここ）と Rust の `wikilink::links_in`
// （索引・改名）。**実際に食い違っていた**（別名を書き換えだけが拾って
// いた = ADR-0064）ので、同じ入力で同じ答えになることを見張る。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { wikilinkTarget } from "./extended-inline";
import { LANG } from "./test-utils";

type Case = { text: string; names: string[] };
const cases: Case[] = JSON.parse(
  readFileSync("fixtures/wikilink-cases.json", "utf8"),
).cases;

/// その本文が指しているノート名（出現順・重複なし）。**本番と同じ関数**
/// （`wikilinkTarget`）で名前を取る — テストが自前で整えると、本番の
/// `activationAt` が Rust とずれていても緑のままになる（レビュー 2026-09-14）
function namesOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const found: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "WikiLink") return;
      const name = wikilinkTarget(doc.slice(node.from + 2, node.to - 2));
      if (name && !found.includes(name)) found.push(name);
    },
  });
  return found;
}

describe("Rust と同じ見本で同じ答えになる", () => {
  test("見本が減っていない", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  test.each(cases.map((c) => [c.text, c] as const))("%s", (_text, c) => {
    expect(namesOf(c.text)).toEqual(c.names);
  });
});

describe("表のセルの中（TS だけの限界。ADR-0064）", () => {
  // 表はブロック段階で `|` を区切りに使うので、セル内の `[[a|b]]` はインラインの
  // 解析に届く前に割れる（Obsidian も同じで `\|` を要求する）。ここで現状を
  // 固定しておく（レビュー 2026-09-14）
  const table = (cell: string) => `| a | b |\n| --- | --- |\n| ${cell} | x |\n`;

  test("test_素の縦棒はセルの区切りになってリンクにならない", () => {
    expect(namesOf(table("[[会議メモ|前回]]"))).toEqual([]);
  });

  test("test_縦棒を_backslash_で逃がせば別名つきリンクになる", () => {
    expect(namesOf(table("[[会議メモ\\|前回]]"))).toEqual(["会議メモ"]);
  });
});
