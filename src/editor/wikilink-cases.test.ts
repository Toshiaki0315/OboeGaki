// ノートリンクの名前の拾い方を、Rust 側と**同じ見本**で突き合わせる
// （fixtures/wikilink-cases.json。TASKS 15-5）。
//
// 規則は 2 か所にある — CM6 のパーサ（ここ）と Rust の `wikilink::links_in`
// （索引・改名）。**実際に食い違っていた**（別名を書き換えだけが拾って
// いた = ADR-0064）ので、同じ入力で同じ答えになることを見張る。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";

type Case = { text: string; names: string[] };
const cases: Case[] = JSON.parse(
  readFileSync("fixtures/wikilink-cases.json", "utf8"),
).cases;

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

/// その本文が指しているノート名（出現順・重複なし）。Rust の `links` と
/// 同じ形に揃える — 空白は畳み、前後は落とす
function namesOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const found: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "WikiLink") return;
      const raw = doc.slice(node.from + 2, node.to - 2);
      const name = raw.split("|")[0].trim().replace(/\s+/g, " ");
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
