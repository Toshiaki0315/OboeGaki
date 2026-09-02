// oracle.json（参照実装 hitofude のスキャナが出した正解）と突き合わせる。
// 素の @lezer/markdown（CommonMark 厳密）が日本語ケースで落ちること（RED）と、
// relaxed-emphasis.mjs を足すと全ケース一致すること（GREEN）を同時に示す。

import { readFileSync } from "node:fs";
import { parser as defaultParser } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis.mjs";

const relaxedParser = defaultParser.configure(relaxedAsterisk);
const oracle = JSON.parse(readFileSync(new URL("./oracle.json", import.meta.url)));

// Emphasis/StrongEmphasis ノードを参照実装の InlineSpan と同じ形に落とす。
// マーカー長 1/2/3 → EM/STRONG/STRONG_EM。
function spansOf(parser, text) {
  const tree = parser.parse(text);
  const out = [];
  tree.iterate({
    enter(n) {
      if (n.name !== "Emphasis" && n.name !== "StrongEmphasis") return;
      const marks = n.node.getChildren("EmphasisMark");
      if (marks.length < 2) return;
      const open = marks[0];
      const close = marks[marks.length - 1];
      const size = open.to - open.from;
      const type = size === 1 ? "EM" : size === 2 ? "STRONG" : "STRONG_EM";
      out.push({ type, open: [open.from, open.to], close: [close.from, close.to] });
    },
  });
  return out.sort((a, b) => a.open[0] - b.open[0]);
}

const key = (spans) => JSON.stringify(spans);
let defaultOk = 0;
let relaxedOk = 0;

for (const { text, spans } of oracle) {
  const expected = key([...spans].sort((a, b) => a.open[0] - b.open[0]));
  const byDefault = key(spansOf(defaultParser, text));
  const byRelaxed = key(spansOf(relaxedParser, text));
  const d = byDefault === expected;
  const r = byRelaxed === expected;
  defaultOk += d;
  relaxedOk += r;
  console.log(`${d ? "d" : "-"}${r ? "R" : "!"} ${text}`);
  if (!r) {
    console.log(`   期待: ${expected}`);
    console.log(`   実際: ${byRelaxed}`);
  }
}

console.log(`\n素の CommonMark: ${defaultOk}/${oracle.length} 一致`);
console.log(`緩和拡張あり:   ${relaxedOk}/${oracle.length} 一致`);
process.exit(relaxedOk === oracle.length ? 0 : 1);
