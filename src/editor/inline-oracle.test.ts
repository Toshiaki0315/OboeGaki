// 参照実装（hitofude の inline_scanner.scan()）の出力をオラクルとして、
// インライン検出の等価性を検証する。オラクルの生成手順は spikes/01-flanking/。
// 対象: 強調（*）・取り消し線（~~）・ハイライト（::）・インラインコード。
//
// 注意: オフセットは JS が UTF-16 コード単位、Python がコードポイント。
// fixtures は BMP 内なので一致するが、絵文字を含むケースを足すときは変換を挟む。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";

type Span = { type: string; open: [number, number]; close: [number, number] };
type OracleCase = { text: string; spans: Span[] };

const parser = baseParser.configure([relaxedAsterisk, extendedInline]);

// 収集対象ノード → 参照実装の SpanType 名。強調はマーカー長で振り分ける
const MARK_CHILD: Record<string, { type: string; mark: string }> = {
  Strikethrough: { type: "STRIKE", mark: "StrikethroughMark" },
  Highlight: { type: "HIGHLIGHT", mark: "HighlightMark" },
  InlineCode: { type: "CODE", mark: "CodeMark" },
};

function readOracle(name: string): OracleCase[] {
  return JSON.parse(
    readFileSync(
      new URL(`../../spikes/01-flanking/${name}`, import.meta.url),
      "utf8",
    ),
  );
}

function toSpan(node: SyntaxNode): Span | null {
  let type: string;
  let markName: string;
  if (node.name === "Emphasis" || node.name === "StrongEmphasis") {
    markName = "EmphasisMark";
    type = ""; // マーカー長で決める
  } else if (node.name in MARK_CHILD) {
    ({ type, mark: markName } = MARK_CHILD[node.name]);
  } else {
    return null;
  }
  const marks = node.getChildren(markName);
  if (marks.length < 2) return null;
  const open = marks[0];
  const close = marks[marks.length - 1];
  if (!type) {
    const size = open.to - open.from;
    type = size === 1 ? "EM" : size === 2 ? "STRONG" : "STRONG_EM";
  }
  return {
    type,
    open: [open.from, open.to],
    close: [close.from, close.to],
  };
}

function spansOf(text: string): Span[] | null {
  const tree = parser.parse(text);
  const top = tree.topNode.firstChild;
  // ブロック要素の行は参照実装のライン単位 scan() と文脈が噛み合わないので対象外
  if (top && top.name !== "Paragraph") return null;
  const out: Span[] = [];
  tree.iterate({
    enter(n) {
      const span = toSpan(n.node);
      if (span) out.push(span);
    },
  });
  return out.sort((a, b) => a.open[0] - b.open[0]);
}

const byPos = (spans: Span[]) =>
  [...spans].sort((a, b) => a.open[0] - b.open[0]);

describe("インライン検出は参照実装と一致する", () => {
  const cases = readOracle("oracle.json");
  test.each(cases.map((c) => [c.text, c] as const))("%s", (_text, c) => {
    expect(spansOf(c.text)).toEqual(byPos(c.spans));
  });

  test("fixtures 全体（段落行のみ）で参照実装と一致する", () => {
    let compared = 0;
    for (const c of readOracle("oracle_fixtures.json")) {
      const got = spansOf(c.text);
      if (got === null) continue;
      compared++;
      expect(got, c.text).toEqual(byPos(c.spans));
    }
    expect(compared).toBeGreaterThan(100);
  });
});
