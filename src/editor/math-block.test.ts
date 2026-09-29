// 数式ブロックのパース（ADR-0036 追記 2026-09-04）。
// レビューで実証: 閉じの無い $$ が「以降の文書全体」を構文木から
// 消していた（BlockParser の契約違反 — false を返すなら nextLine で
// 進んではいけない）。閉じが無いときはコードフェンスと同じく
// 「文書末まで数式ブロック」とし、木は常に成立させる。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { blockWidgetDecorations } from "./live-preview";
import { sourceModeField } from "./live-preview";
import { LANG } from "./test-utils";

function nodesOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [LANG] });
  const names: string[] = [];
  // **木を待つ。** `syntaxTree` は時間で打ち切られるので、全体を回すと
  // 木が未完成のまま返り、後ろのノードが落ちる（2026-09-05）
  const tree = ensureSyntaxTree(state, doc.length, 1000) ?? syntaxTree(state);
  tree.iterate({
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

describe("引用の中の数式ブロック（24-5）", () => {
  test("test_引用が終わったところで数式ブロックも終わる（コードフェンスと同じ）", () => {
    // 以前は引用の外まで伸び、下の見出しや本文の装飾が消え、引用の線が付いた
    const doc = "> $$\n> x\n\n# 見出し\n\n本文 **強**";
    const state = EditorState.create({ doc, extensions: [LANG] });
    const tree = ensureSyntaxTree(state, doc.length, 1000)!;
    const top: string[] = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      top.push(node.name);
    }
    expect(top).toEqual(["Blockquote", "ATXHeading1", "Paragraph"]);
    let math: { from: number; to: number } | null = null;
    tree.iterate({
      enter: (node) => {
        if (node.name === "MathBlock") math = { from: node.from, to: node.to };
      },
    });
    expect(math).not.toBeNull();
    expect(doc.slice(math!.from, math!.to)).toBe("> $$\n> x");
  });
});
