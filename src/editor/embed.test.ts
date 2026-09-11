// 埋め込み `![[ノート名]]`（ADR-0058 / 12-7）の記法。Lezer の木で確かめる
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { Table, TaskList } from "@lezer/markdown";
import { describe, expect, test } from "vitest";
import { extendedInline } from "./extended-inline";
import { relaxedAsterisk } from "./relaxed-emphasis";

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function nodesOf(doc: string): { name: string; from: number; to: number }[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const tree = ensureSyntaxTree(state, doc.length, 1000)!;
  const out: { name: string; from: number; to: number }[] = [];
  tree.iterate({
    enter: (node) =>
      void out.push({ name: node.name, from: node.from, to: node.to }),
  });
  return out;
}

describe("Embed", () => {
  test("test_![[名前]] は Embed ノード_印は !![ と ]]", () => {
    const doc = "前 ![[会議メモ#決定]] 後";
    const found = nodesOf(doc);
    const embed = found.find((n) => n.name === "Embed")!;
    expect(embed).toBeTruthy();
    expect(doc.slice(embed.from, embed.to)).toBe("![[会議メモ#決定]]");
    const marks = found.filter((n) => n.name === "EmbedMark");
    expect(marks.map((m) => doc.slice(m.from, m.to))).toEqual(["![[", "]]"]);
    // ふつうの画像やリンクには化けない
    expect(found.some((n) => n.name === "Image" || n.name === "WikiLink")).toBe(
      false,
    );
  });
  test("test_名前が空_| 入り_閉じ無しは Embed にしない", () => {
    expect(nodesOf("![[ ]]").some((n) => n.name === "Embed")).toBe(false);
    expect(nodesOf("![[a|b]]").some((n) => n.name === "Embed")).toBe(false);
    expect(nodesOf("![[a").some((n) => n.name === "Embed")).toBe(false);
  });
});
