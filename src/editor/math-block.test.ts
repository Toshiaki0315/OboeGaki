// 数式ブロックのパース（ADR-0036 追記 2026-09-04）。
// レビューで実証: 閉じの無い $$ が「以降の文書全体」を構文木から
// 消していた（BlockParser の契約違反 — false を返すなら nextLine で
// 進んではいけない）。閉じが無いときはコードフェンスと同じく
// 「文書末まで数式ブロック」とし、木は常に成立させる。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { blockWidgetDecorations } from "./live-preview";
import { sourceModeField } from "./live-preview";

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function nodesOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const names: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

describe("MathBlock", () => {
  test("test_閉じたブロックは前後の本文を壊さない", () => {
    const names = nodesOf("# 前\n\n$$\nx = 1\n$$\n\n# 後\n本文\n");
    expect(names.filter((n) => n === "ATXHeading1")).toHaveLength(2);
    expect(names).toContain("MathBlock");
  });

  test("test_閉じが無くても前の本文は木に残る", () => {
    // 旧実装はここで Document 以外の全ノードが消えていた（実証済み）
    const names = nodesOf("# 前\n\n$$\nx = 1\n\n# 後\n");
    expect(names).toContain("ATXHeading1");
    expect(names).toContain("MathBlock");
  });

  test("test_閉じが無ければ文書末まで数式ブロック（フェンスと同じ）", () => {
    const doc = "$$\nx = 1\n続きの文\n";
    const state = EditorState.create({ doc, extensions: [LANG] });
    let mathTo = -1;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "MathBlock") mathTo = node.to;
      },
    });
    expect(mathTo).toBe(doc.length); // 末尾の空行も含めて文書末まで
  });

  test("test_引用の中でも閉じられる", () => {
    const names = nodesOf("> $$\n> x = 1\n> $$\n\n# 後\n");
    expect(names).toContain("MathBlock");
    expect(names).toContain("ATXHeading1");
  });

  test("test_閉じの無いブロックは絵にしない（生のまま見せる）", () => {
    const doc = "$$\nx = 1\ny = 2\n";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [LANG, sourceModeField],
    });
    // キャレットは触れているが、範囲外から見ても widget を作らないことを
    // 確かめたいので選択を外へ置けない（文書全体がブロック）。
    // 閉じていない以上、widget は常に無し
    const widgets = blockWidgetDecorations(state).filter(
      (r) => (r.value.spec as { widget?: object }).widget,
    );
    expect(widgets).toHaveLength(0);
  });
});
