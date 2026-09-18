// fixtures/*.md と fixtures/golden/*.json（参照実装から持ち込んだ仕様資産）を
// **ブロックの種類**で突き合わせる。golden の ranges（`hidden:0.5` など）は
// Qt の表現なので見ない。行ごとの block（見出し・箇条書き・フェンス…）が
// Lezer の木から同じに読めることだけを固定する（TASKS 17-8: どのテストからも
// 読まれていなかった）。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { frontMatterRange } from "./frontmatter";
import { LANG } from "./test-utils";

type GoldenLine = { line: number; text: string; block: string };

/// 参照実装（Qt 版）と**意図して違えるもの**。golden は書き換えない（持ち込んだ
/// 資産）。こちらの期待を書いて突き合わせる（inline-oracle.test.ts と同じ作法）
/// - 見出しと区切りの列数が違う表は GFM では表でない（参照実装は緩く表にした）
/// - `見出しに見える行\n---` は GFM の Setext 見出し（参照実装は未対応で段落 + 水平線）
const DIVERGENT: Record<string, string> = {
  "edge_cases:62": "PARAGRAPH",
  "edge_cases:63": "PARAGRAPH",
  "edge_cases:64": "PARAGRAPH",
  "edge_cases:72": "HEADING",
  "edge_cases:73": "HEADING",
};

/// その行の種類（golden の語彙で）
function blockOf(
  state: EditorState,
  lineNumber: number,
  frontEnd: number,
): string {
  const line = state.doc.line(lineNumber + 1);
  if (line.from < frontEnd) return "FRONT_MATTER";
  if (line.text.trim() === "") return "BLANK";
  const chain: SyntaxNode[] = [];
  // 字下げした箇条書きは行頭の空白では親の段落に解決されるので、最初の字で引く
  const head = line.from + (line.text.match(/^\s*/)?.[0].length ?? 0);
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, 1);
    node && node.name !== "Document";
    node = node.parent
  ) {
    chain.push(node);
  }
  const names = chain.map((n) => n.name);
  const fence = chain.find((n) => n.name === "FencedCode");
  if (fence) {
    const first = state.doc.lineAt(fence.from).number;
    const last = state.doc.lineAt(fence.to).number;
    const closed = fence.getChildren("CodeMark").length >= 2;
    if (line.number === first) return "CODE_FENCE_OPEN";
    if (line.number === last && closed) return "CODE_FENCE_CLOSE";
    return "CODE_FENCE_BODY";
  }
  if (names.includes("Table")) {
    // `|` の記号も TableDelimiter ノードなので、区切り行は字面で見る
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line.text)
      ? "TABLE_DELIMITER"
      : "TABLE_ROW";
  }
  if (names.some((n) => /^(ATX|Setext)Heading[1-6]$/.test(n))) return "HEADING";
  if (names.includes("HorizontalRule")) return "HORIZONTAL_RULE";
  const item = chain.find((n) => n.name === "ListItem");
  if (item && state.doc.lineAt(item.from).number === line.number) {
    if (item.getChild("Task")) return "TASK_LIST_ITEM";
    return item.parent?.name === "OrderedList"
      ? "ORDERED_LIST_ITEM"
      : "BULLET_LIST_ITEM";
  }
  if (names.includes("Blockquote")) return "BLOCKQUOTE";
  return "PARAGRAPH";
}

describe("fixtures/golden のブロック種別と一致する", () => {
  for (const name of ["basic", "japanese", "edge_cases"]) {
    test(name, () => {
      const text = readFileSync(`fixtures/${name}.md`, "utf8");
      const golden: GoldenLine[] = JSON.parse(
        readFileSync(`fixtures/golden/${name}.json`, "utf8"),
      );
      const state = EditorState.create({ doc: text, extensions: [LANG] });
      const frontEnd = frontMatterRange(text)?.to ?? 0;
      const mismatches = golden
        .filter(
          (g) =>
            (DIVERGENT[`${name}:${g.line}`] ?? g.block) !==
            blockOf(state, g.line, frontEnd),
        )
        .map(
          (g) =>
            `${g.line}: ${JSON.stringify(g.text)} golden=${g.block} lezer=${blockOf(state, g.line, frontEnd)}`,
        );
      expect(mismatches).toEqual([]);
    });
  }
});
