// 参照実装（hitofude の inline_scanner.scan()）の出力をオラクルとして
// flanking 緩和の等価性を検証する。オラクルの生成手順は spikes/01-flanking/。
//
// 注意: オフセットは JS が UTF-16 コード単位、Python がコードポイント。
// fixtures は BMP 内なので一致するが、絵文字を含むケースを足すときは変換を挟む。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";

type Span = { type: string; open: [number, number]; close: [number, number] };
type OracleCase = { text: string; spans: Span[] };

const parser = baseParser.configure(relaxedAsterisk);

function readOracle(name: string): OracleCase[] {
  return JSON.parse(
    readFileSync(new URL(`../../spikes/01-flanking/${name}`, import.meta.url), "utf8"),
  );
}

// Emphasis/StrongEmphasis ノードを参照実装の InlineSpan と同じ形に落とす。
// マーカー長 1/2/3 → EM/STRONG/STRONG_EM。
function spansOf(text: string): Span[] | null {
  const tree = parser.parse(text);
  const top = tree.topNode.firstChild;
  // ブロック要素の行は参照実装のライン単位 scan() と文脈が噛み合わないので対象外
  if (top && top.name !== "Paragraph") return null;
  const out: Span[] = [];
  tree.iterate({
    enter(n) {
      if (n.name !== "Emphasis" && n.name !== "StrongEmphasis") return;
      const marks = n.node.getChildren("EmphasisMark");
      if (marks.length < 2) return;
      const open = marks[0];
      const close = marks[marks.length - 1];
      const size = open.to - open.from;
      out.push({
        type: size === 1 ? "EM" : size === 2 ? "STRONG" : "STRONG_EM",
        open: [open.from, open.to],
        close: [close.from, close.to],
      });
    },
  });
  return out.sort((a, b) => a.open[0] - b.open[0]);
}

const byPos = (spans: Span[]) => [...spans].sort((a, b) => a.open[0] - b.open[0]);

describe("relaxedAsterisk は参照実装と同じ強調を検出する", () => {
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
