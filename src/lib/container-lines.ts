// 書き出し（HTML / Word / スライド）が `:::` の囲みを画面と同じに読むための
// 下ごしらえ（22-P / 22-3。ADR-0069）。
//
// 囲みの見つけ方は markdown/containers の `colonContainers` 1 本。ここは
// 「どの行が字のまま読まれるか（コード・数式ブロックの中）」を Lezer で答え、
// markdown-it に渡す前の本文を整える。

import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { colonContainers, type ColonContainer } from "../markdown/containers";
import { relaxedAsterisk } from "../editor/relaxed-emphasis";
import { extendedInline } from "../editor/extended-inline";

const parser = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
}).language.parser;

/// 字のまま読まれるブロック。この中の `:::` は囲みの開きにも閉じにもしない
const VERBATIM = new Set(["FencedCode", "CodeBlock", "MathBlock"]);

/// 本文の行と、囲みを見るときに飛ばす行（コード・数式ブロックの中。リストや
/// 引用の中のものも含む）
export function containersOf(text: string): {
  lines: string[];
  verbatim: Set<number>;
  containers: ColonContainer[];
} {
  const lines = text.split("\n");
  const verbatim = new Set<number>();
  if (!text.includes(":::")) return { lines, verbatim, containers: [] };
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineOf = (pos: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= pos) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  parser.parse(text).iterate({
    enter: (node) => {
      if (!VERBATIM.has(node.name)) return;
      const last = lineOf(Math.max(node.from, node.to - 1));
      for (let line = lineOf(node.from); line <= last; line++) {
        verbatim.add(line);
      }
      return false;
    },
  });
  const containers = colonContainers(lines, (index) => verbatim.has(index));
  return { lines, verbatim, containers };
}

/// 行の中身の頭（引用の `>`・リストの印・字下げの後ろ）が `:::` で始まるか。
/// markdown-it-container はどの入れ物の中でも囲みを開くので、画面が囲みにしない
/// ものはここで見つけて逃がす
const COLON_RUN_RE =
  /^([ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(:{3,})/;

/// markdown-it（markdown-it-container）に渡す前の本文。**画面と同じ囲みだけを
/// 囲みとして組ませる**:
///
/// - 画面が認めた囲みは、区切りのコロンを中のどの行よりも長くする。
///   markdown-it-container は閉じを探すときに中のフェンスを見ないので、コードの
///   中の `:::` で閉じていた（画面は閉じない。22-1）
/// - それ以外の `:::` の行（閉じの無い開き・開いている間の開き・字下げや引用の
///   中の開き・余った閉じ）は、頭のコロンを `\:` と逃がして字のまま出す。
///   markdown-it-container は入れ子を組み、閉じの無い開きも文書末まで伸ばす
///   ので、そのまま渡すと画面と食い違う（ADR-0069 の決定 3）
/// - コードと数式ブロックの中は 1 字も変えない
export function forMarkdownIt(text: string): string {
  const { lines, verbatim, containers } = containersOf(text);
  if (!text.includes(":::")) return text;
  const marker = new Map<number, number>();
  for (const { open, close } of containers) {
    let longest = 2;
    for (let line = open + 1; line < close; line++) {
      const run = /^[ \t]*(:+)/.exec(lines[line])?.[1].length ?? 0;
      longest = Math.max(longest, run);
    }
    marker.set(open, longest + 1);
    marker.set(close, longest + 1);
  }
  return lines
    .map((line, index) => {
      const length = marker.get(index);
      if (length !== undefined) return ":".repeat(length) + line.slice(3);
      if (verbatim.has(index)) return line;
      return line.replace(
        COLON_RUN_RE,
        (_, head: string, run: string) => `${head}\\${run}`,
      );
    })
    .join("\n");
}
