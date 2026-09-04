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

/// 装飾を持った文字のかたまり（TASKS 5-1）。**記号は落とすが装飾は落とさない** —
/// 素の文字にすると、書いた人が PowerPoint 側で付け直すことになる。
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /// リンクの行き先（`[題](url)` の url）
  link?: string;
};

export type SlideBlock =
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "heading"; runs: Run[] }
  | { kind: "bullet"; runs: Run[]; level: number }
  | { kind: "code"; text: string; language: string }
  | { kind: "table"; rows: string[] };

/// 装飾を落とした文字（題名・発表者ノート・テストが使う）。
export function plainText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

export type Slide = {
  /// `section` は扉（題だけの 1 枚）。2 つ目以降の `#` がこれになる
  kind: "content" | "section";
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
      if (level === 1 && !deck.title) {
        deck.title = body;
      } else if (level === 1) {
        // **2 つ目以降の `#` は扉にする**（TASKS 5-3）。これまでは捨てて
        // いたので、書いた区切りが PowerPoint 側に届かなかった
        deck.slides.push({
          kind: "section",
          title: body,
          blocks: [],
          images: [],
          notes: "",
        });
        current = null; // 扉に本文は載せない（次の `##` から拾う）
      } else if (level === 2) {
        current = {
          kind: "content",
          title: body,
          blocks: [],
          images: [],
          notes: "",
        };
        deck.slides.push(current);
      } else {
        add({ kind: "heading", runs: runsOf(text, node) });
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
        const runs = runsOf(text, node);
        if (plainText(runs) === "") break;
        if (current) add({ kind: "paragraph", runs });
        else subtitle.push(plainText(runs)); // 表紙に載る文章はここにある
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
            runs: runsOf(text, item.node),
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

/// 横並びの箱（TASKS 5-4）。小見出しごとに 1 つ。
export type Card = { heading: Run[]; blocks: SlideBlock[] };

/// 箱にできる数の上限。**5 つ以上は細すぎて読めない**（横幅の割り算）。
const MAX_CARDS = 4;

/// スライドを横並びの箱に割る。割らないほうがよければ null。
///
/// **新しい記法を作らない。** 小見出し（`###`）がそのまま箱になる。書く側は
/// 今までどおりの書き方で、段組みが要るときだけ小見出しを 2 つ以上置く。
///
/// 割らない場合:
/// - 小見出しが 1 つだけ（横に並ばない）
/// - 小見出しの前に本文がある（箱に入らない文が浮く）
/// - コードや表がある（幅が要るものを横に割ると読めない）
/// - 箱が 5 つ以上（細すぎる）
///
/// **迷ったら今までの並べ方に倒す。** 崩れた段組みより、縦に流れるほうがよい。
export function cardsOf(blocks: readonly SlideBlock[]): Card[] | null {
  if (blocks.some((block) => block.kind === "code" || block.kind === "table")) {
    return null;
  }
  if (blocks.length === 0 || blocks[0].kind !== "heading") return null;
  const cards: Card[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      cards.push({ heading: block.runs, blocks: [] });
    } else {
      cards[cards.length - 1].blocks.push(block);
    }
  }
  if (cards.length < 2 || cards.length > MAX_CARDS) return null;
  return cards;
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

/// 装飾ごと拾った本文（TASKS 5-1）。
///
/// **記号は落とすが、装飾は落とさない。** 太字を素の文字にすると、書いた人が
/// PowerPoint 側で付け直すことになる。入れ子のリストとコードは含めない
/// （それぞれ別のブロックとして拾う）。
function runsOf(text: string, node: SyntaxNode): Run[] {
  const runs: Run[] = [];
  const styles: Run[] = [];
  let pos = node.from;

  const style = (): Omit<Run, "text"> =>
    styles.reduce<Omit<Run, "text">>((merged, item) => {
      const { text: _drop, ...rest } = item;
      return { ...merged, ...rest };
    }, {});

  const emit = (to: number) => {
    if (to <= pos) return;
    const slice = text.slice(pos, to);
    pos = to;
    if (slice) runs.push({ text: slice, ...style() });
  };

  // **「自分自身か」を範囲で見ない。** 段落の全体が太字のとき
  // （`**…**` だけの行）、StrongEmphasis の範囲は段落と同じになり、
  // 自分と取り違えて装飾を取りこぼす（実測 2026-09-05）。
  // 最初に入るのは必ず自分なので、数えて判じる
  let entered = 0;
  node.cursor().iterate(
    (child) => {
      if (++entered === 1) return true;
      if (
        SKIP.has(child.name) ||
        MARKS.has(child.name) ||
        child.name === "URL"
      ) {
        // 記号と、別に拾うもの（入れ子のリスト・コード）は本文に出さない
        emit(child.from);
        pos = Math.max(pos, child.to);
        return false;
      }
      const styled = STYLES[child.name];
      if (styled) {
        emit(child.from);
        styles.push(
          child.name === "Link"
            ? { text: "", link: linkTarget(text, child.node) }
            : { text: "", ...styled },
        );
      }
      return true;
    },
    (child) => {
      if (!STYLES[child.name] || styles.length === 0) return;
      emit(child.to);
      styles.pop();
    },
  );
  emit(node.to);
  return tidy(runs);
}

/// 装飾の名前 → 付ける印。Lezer のノード名で引く。
const STYLES: Record<string, Omit<Run, "text"> | undefined> = {
  StrongEmphasis: { bold: true },
  Emphasis: { italic: true },
  Strikethrough: { strike: true },
  InlineCode: { code: true },
  Link: {}, // 行き先は linkTarget が読む
};

/// 別のブロックとして拾うもの（本文には混ぜない）。
const SKIP = new Set(["BulletList", "OrderedList", "FencedCode", "CodeBlock"]);

function linkTarget(text: string, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  return url ? text.slice(url.from, url.to) : undefined;
}

/// 改行を空白に畳み、両端を落とし、同じ装飾の隣どうしを繋ぐ。
/// **途中の空白は残す**（`a **b** c` の空白が消えると語が繋がる）。
function tidy(runs: Run[]): Run[] {
  const folded = runs
    .map((run) => ({ ...run, text: run.text.replace(/\s*\n\s*/g, " ") }))
    .filter((run) => run.text !== "");
  const merged: Run[] = [];
  for (const run of folded) {
    const last = merged[merged.length - 1];
    const sameStyle =
      last &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.strike === run.strike &&
      last.code === run.code &&
      last.link === run.link;
    if (sameStyle) last.text += run.text;
    else merged.push({ ...run });
  }
  if (merged.length > 0) {
    merged[0].text = merged[0].text.replace(/^\s+/, "");
    const last = merged[merged.length - 1];
    last.text = last.text.replace(/\s+$/, "");
  }
  return merged.filter((run) => run.text !== "");
}

/// 記号を外した本文（題名・発表者ノート用。装飾は持たない）。
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
