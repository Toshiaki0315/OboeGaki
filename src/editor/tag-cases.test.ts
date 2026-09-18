// `#タグ` の拾い方を Rust（索引の tags::extract_tags）と**同じ見本**で
// 突き合わせる（fixtures/tag-cases.json。TASKS 17-8）。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { normalizeTag } from "../markdown/tag-name";
import { LANG } from "./test-utils";

type Case = { text: string; tags: string[] };
const cases: Case[] = JSON.parse(
  readFileSync("fixtures/tag-cases.json", "utf8"),
).cases;

/// 本文が持つタグ（出現順・重複なし・正規化済み）。Rust の extract_tags と同じ形
function tagsOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const found: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Hashtag") return;
      const name = normalizeTag(doc.slice(node.from + 1, node.to));
      if (name && !found.includes(name)) found.push(name);
    },
  });
  return found;
}

describe("Rust と同じ見本で同じ答えになる", () => {
  test.each(cases.map((c) => [JSON.stringify(c.text), c] as const))(
    "%s",
    (_text, c) => {
      expect(tagsOf(c.text)).toEqual(c.tags);
    },
  );
});
