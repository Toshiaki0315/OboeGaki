// Markdown をスライドの構造に割る（TASKS 4-5 / F-4）。
//
// **書き出しの土台。** ここは純関数で、PowerPoint そのものは知らない
// （組み立ては lib/pptx.ts）。分けておくと、割り方の規則をヘッドレスで
// 固定できる。
//
// 区切りは参照実装（core/slides.py）がユーザーと決めたものをそのまま:
//
// - `#` は**表紙**。その周りの段落が副題になる
// - `##` ごとに 1 枚
// - `###` 以下はスライドの中の小見出し
// - 画像は**右側**に置くので、本文とは分けて持つ
// - `>` の引用は**発表者ノート**（スライドには出さない）
//
// **解析はエディタと同じ Lezer に任せる。** パーサを 2 本にしない
// （ADR-0007 の判断）。フェンス・表・引用の細かい規則を書き直さずに済む。

import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { relaxedAsterisk } from "../editor/relaxed-emphasis";
import { extendedInline } from "../editor/extended-inline";

export type SlideBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string; level: number }
  | { kind: "code"; text: string; language: string }
  | { kind: "table"; rows: string[] };

export type Slide = {
  title: string;
  blocks: SlideBlock[];
  /// 右側に置く画像のパス。**本文とは分ける**（並びに混ぜない）。
  images: string[];
  /// 発表者ノート。スライドには出さない。
  notes: string;
};

export type Deck = {
  title: string;
  subtitle: string;
  slides: Slide[];
};

const parser = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
}).language.parser;

const HEADING = /^ATXHeading(\d)$/;
// 装飾の記号（スライドに `**` を出さない）。本文の写しを作るだけで、
// ソースには触れない
const MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "LinkMark",
  "WikiLinkMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
]);

export function splitDeck(text: string): Deck {
  const tree = parser.parse(text);
  const deck: Deck = { title: "", subtitle: "", slides: [] };
  const subtitle: string[] = [];
  let current: Slide | null = null;

  const add = (block: SlideBlock) => {
    if (current) current.blocks.push(block);
  };

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const heading = HEADING.exec(node.name);
    if (heading) {
      const level = Number(heading[1]);
      const body = plain(text, node);
      if (level === 1) {
        deck.title = deck.title || body;
      } else if (level === 2) {
        current = { title: body, blocks: [], images: [], notes: "" };
        deck.slides.push(current);
      } else {
        add({ kind: "heading", text: body });
      }
      continue;
    }
    switch (node.name) {
      case "Paragraph": {
        const image = imageOnly(text, node);
        if (image !== null) {
          // **右側に置くので本文に混ぜない**（決めた並べ方）
          if (current) current.images.push(image);
          break;
        }
        const body = plain(text, node);
        if (!body) break;
        if (current) add({ kind: "paragraph", text: body });
        else subtitle.push(body); // 表紙に載る文章はここにある
        break;
      }
      case "Blockquote": {
        const body = plain(text, node);
        if (current && body) {
          current.notes = current.notes ? `${current.notes}\n${body}` : body;
        }
        break;
      }
      case "BulletList":
      case "OrderedList":
        for (const item of listItems(node)) {
          add({
            kind: "bullet",
            text: plain(text, item.node),
            level: item.level,
          });
        }
        break;
      case "FencedCode":
      case "CodeBlock":
        add(fencedCode(text, node));
        break;
      case "Table":
        add({
          kind: "table",
          // 区切り行（`| --- |`）は形式の飾り。中身を持たない
          rows: text
            .slice(node.from, node.to)
            .split("\n")
            .map((row) => row.trim())
            .filter((row) => row && !/^\|?[\s:|-]+\|?$/.test(row)),
        });
        break;
      default:
        break;
    }
  }
  deck.subtitle = subtitle.join("\n");
  return deck;
}

/// 箇条書きの項目を階層ごとに平らに並べる。
function listItems(
  list: SyntaxNode,
  level = 0,
): { node: SyntaxNode; level: number }[] {
  const found: { node: SyntaxNode; level: number }[] = [];
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue;
    found.push({ node: item, level });
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === "BulletList" || child.name === "OrderedList") {
        found.push(...listItems(child, level + 1));
      }
    }
  }
  return found;
}

function fencedCode(text: string, node: SyntaxNode): SlideBlock {
  const info = node.getChild("CodeInfo");
  const body = node.getChild("CodeText");
  return {
    kind: "code",
    text: body ? text.slice(body.from, body.to) : "",
    language: info ? text.slice(info.from, info.to).trim() : "",
  };
}

/// 画像だけの段落ならその URL。違えば null。
function imageOnly(text: string, node: SyntaxNode): string | null {
  const body = text.slice(node.from, node.to).trim();
  const image = node.firstChild;
  if (!image || image.name !== "Image") return null;
  if (text.slice(image.from, image.to).trim() !== body) return null;
  const url = image.getChild("URL");
  return url ? text.slice(url.from, url.to) : null;
}

/// 記号を外した本文（入れ子のリストとコードは含めない）。
function plain(text: string, node: SyntaxNode): string {
  const drops: [number, number][] = [];
  const skip = new Set([
    "BulletList",
    "OrderedList",
    "FencedCode",
    "CodeBlock",
  ]);
  node.cursor().iterate((child) => {
    if (child.from === node.from && child.to === node.to) return true;
    if (skip.has(child.name)) {
      drops.push([child.from, child.to]);
      return false;
    }
    if (MARKS.has(child.name)) {
      drops.push([child.from, child.to]);
      return false;
    }
    return true;
  });
  drops.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = node.from;
  for (const [from, to] of drops) {
    if (to <= pos) continue;
    if (from > pos) out += text.slice(pos, from);
    pos = Math.max(pos, to);
  }
  out += text.slice(pos, node.to);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}
