// ノートを Qiita へ送る形に整える（TASKS 14-2 / ADR-0063）。通信はしない — 送るのは
// Rust 側（トークンを WebView に渡さない）。ここは本文 → { 題, 本文, タグ, 載らない画像 }
// の純関数で、決めたこと（ADR-0063 の「決定」）をそのまま書く:
//
// | 元 | 送る形 |
// | --- | --- |
// | front matter | 外す |
// | 先頭の `# 題` | `title` へ（本文からは外す） |
// | 本文の `#タグ` | タグの初期値（本文には残す） |
// | `[[設計|手引き]]` / `[[設計]]` | `手引き` / `設計` |
// | 行まるごとの `![[部品]]` | 部品の本文（1 段だけ。中の記法も直す） |
// | `::大事::` | `大事` |
// | `:::center` / `:::right` | 囲みを外して中身だけ |
// | 文字色の `<span style>` | タグを外して中身だけ |
// | `![図|320](…)` | `![図](…)`（Qiita は大きさの記法を知らず alt に字のまま出す） |
// | 保管フォルダの中の画像 | そのまま送り、数えて返す（投稿前の警告に使う） |
//
// 数式・Mermaid・`:::note` / `:::details`・コードのファイル名ラベルは Qiita も読むので
// 触らない。**コードの中は触らない** — 画面と同じ Lezer のパーサで構文木を辿るので、
// コードの中の `[[ ]]` や `::` はそもそもノードにならない。

import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { relaxedAsterisk } from "../editor/relaxed-emphasis";
import { extendedInline } from "../editor/extended-inline";
import { bodyText, frontMatterRange } from "../markdown/front-matter";
import { splitImageAlt } from "../markdown/image-size";
import { splitEmbedTarget } from "../markdown/section";
import { normalizeTag } from "../markdown/tag-name";
import { containersOf } from "./container-lines";
import { firstHeadingLine, stripInline } from "./note-title";
import { isSpanClose, parseColorSpan, spanStyleOf } from "./text-color";

export type QiitaDraft = {
  title: string;
  body: string;
  /// 本文の `#タグ`（出てきた順・重複なし・`#` なし）。投稿の小窓で足し引きする
  tags: string[];
  /// 保管フォルダの中を指す画像（重複なし）。Qiita に載らない（API に上げる口が無い）
  localImages: string[];
};

const parser = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
}).language.parser;

/// 字のまま読まれるもの。中は辿らない
const VERBATIM = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "MathBlock",
  "InlineMath",
]);

/// Qiita に載る画像（外から引ける URL）。それ以外は保管フォルダの中を指す
const REMOTE_IMAGE = /^https?:\/\//i;

/// ノートを送る形にする。H1 が無ければ fallbackTitle（ファイル名）を題にする。
/// embeds は HTML 書き出しと同じ「埋め込みの名指し → 中身」（App の resolveEmbeds）
export function qiitaDraft(
  text: string,
  fallbackTitle: string,
  embeds: ReadonlyMap<string, string> = new Map(),
): QiitaDraft {
  const { title, rest } = splitTitle(text, fallbackTitle);
  const tags: string[] = [];
  const localImages: string[] = [];
  const body = rewrite(rest, { embeds, tags, localImages });
  return { title, body: dropAlignContainers(body), tags, localImages };
}

/// front matter と先頭の `# 題` を外す。題の行の直後の空行も 1 つ外す
function splitTitle(
  text: string,
  fallbackTitle: string,
): { title: string; rest: string } {
  const start = frontMatterRange(text)?.bodyStart ?? 0;
  const heading = firstHeadingLine(text);
  if (!heading) return { title: fallbackTitle, rest: bodyText(text) };
  const title = stripInline(heading.line.replace(/^# +/, ""))
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  const after = text.slice(heading.to + 1).replace(/^[ \t]*\n/, "");
  const rest = (text.slice(start, heading.from) + after).replace(/^\n+/, "");
  return { title: title || fallbackTitle, rest };
}

type Sink = {
  /// null なら埋め込みを展開しない（埋め込みの中身 = 1 段だけ）
  embeds: ReadonlyMap<string, string> | null;
  /// null ならタグを拾わない（埋め込んだ別のノートのタグは、このノートのものではない）
  tags: string[] | null;
  localImages: string[];
};

type Edit = { from: number; to: number; insert: string };

/// 構文木を辿り、行の中の独自の記法を直す
function rewrite(text: string, sink: Sink): string {
  const edits: Edit[] = [];
  // 開いている span ごとに「外したか」。閉じの `</span>` は対の開きと同じ扱いにする
  const spans: boolean[] = [];
  const seenTags = new Set<string>();
  parser.parse(text).iterate({
    enter: (ref) => {
      if (VERBATIM.has(ref.name)) return false;
      const slice = text.slice(ref.from, ref.to);
      switch (ref.name) {
        case "WikiLink": {
          edits.push({
            from: ref.from,
            to: ref.to,
            insert: wikiLinkText(slice),
          });
          return false;
        }
        case "Embed": {
          edits.push({
            from: ref.from,
            to: ref.to,
            insert: embedText(text, ref.from, ref.to, sink),
          });
          return false;
        }
        case "HighlightMark":
          edits.push({ from: ref.from, to: ref.to, insert: "" });
          return false;
        case "Hashtag": {
          const tag = slice.slice(1);
          const key = normalizeTag(tag);
          if (sink.tags && key && !seenTags.has(key)) {
            seenTags.add(key);
            sink.tags.push(tag);
          }
          return false;
        }
        case "Image":
          image(text, ref.node, sink, edits);
          return; // alt の中の記法も直す
        case "HTMLTag": {
          const style = spanStyleOf(slice);
          if (style !== null) {
            const color = parseColorSpan(style) !== null;
            spans.push(color);
            if (color) edits.push({ from: ref.from, to: ref.to, insert: "" });
          } else if (isSpanClose(slice) && spans.pop()) {
            edits.push({ from: ref.from, to: ref.to, insert: "" });
          }
          return false;
        }
      }
    },
  });
  return applyEdits(text, edits);
}

/// `[[名前|別名]]` → 別名（空なら名前）
function wikiLinkText(raw: string): string {
  const inner = raw.slice(2, -2);
  const pipe = inner.indexOf("|");
  if (pipe < 0) return inner.trim();
  const alias = inner.slice(pipe + 1).trim();
  return alias || inner.slice(0, pipe).trim();
}

/// `![[部品]]` が行まるごとで中身が引ければ中身（1 段だけ）。それ以外は名前
function embedText(text: string, from: number, to: number, sink: Sink): string {
  const target = text.slice(from + 3, to - 2);
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", to);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const whole = line.trim() === text.slice(from, to);
  const found = sink.embeds?.get(target);
  if (whole && found !== undefined) {
    const inner = rewrite(bodyText(found), {
      embeds: null,
      tags: null,
      localImages: sink.localImages,
    });
    return inner.replace(/\n+$/, "");
  }
  return splitEmbedTarget(target).name;
}

/// 画像: 保管フォルダの中を指すものを数え、alt の大きさの指定を外す
function image(
  text: string,
  node: SyntaxNode,
  sink: Sink,
  edits: Edit[],
): void {
  const url = node.getChild("URL");
  if (url) {
    const target = text.slice(url.from, url.to);
    if (!REMOTE_IMAGE.test(target) && !sink.localImages.includes(target)) {
      sink.localImages.push(target);
    }
  }
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2) return;
  const from = marks[0].to;
  const to = marks[1].from;
  const { alt, width } = splitImageAlt(text.slice(from, to));
  if (width !== undefined) edits.push({ from, to, insert: alt });
}

/// 寄せの囲み（`:::center` / `:::right`）の開きと閉じの行を外す。中身は残す
function dropAlignContainers(text: string): string {
  const { lines, containers } = containersOf(text);
  const drop = new Set<number>();
  for (const container of containers) {
    if (container.form !== "colon") continue;
    if (container.kind !== "center" && container.kind !== "right") continue;
    drop.add(container.open);
    drop.add(container.close);
  }
  if (drop.size === 0) return text;
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}

function applyEdits(text: string, edits: Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}
