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
import MarkdownIt from "markdown-it";
import { Table, TaskList } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { containersOf } from "./container-lines";
import { DEFAULT_SUMMARY } from "../editor/details-container";
import { xmlSafeText } from "./xml-safe";
import { bodyText } from "../markdown/front-matter";
import { splitImageAlt } from "../markdown/image-size";
import { plainText, sameStyle, type Run } from "../markdown/runs";
import {
  hexForPptx,
  isSpanClose,
  parseColorSpan,
  spanStyleOf,
} from "./text-color";
import { relaxedAsterisk } from "../editor/relaxed-emphasis";
import { extendedInline } from "../editor/extended-inline";

/// 装飾を持った文字のかたまり（TASKS 5-1）。Word と共有（ADR-0068 / markdown/runs）
export type { Run } from "../markdown/runs";
export { plainText } from "../markdown/runs";

/// 段落と小見出しの寄せ（`:::center` / `:::right`。ADR-0069 / 22-5）。
/// 無ければ左（既定）
export type SlideAlign = "center" | "right";

export type SlideBlock =
  | { kind: "paragraph"; runs: Run[]; align?: SlideAlign }
  | { kind: "heading"; runs: Run[]; align?: SlideAlign }
  | { kind: "bullet"; runs: Run[]; level: number }
  | { kind: "code"; text: string; language: string }
  /// 表。区切り行は落とし、セルごとに run で持つ（`\|` は字、`**` は装飾に。
  /// 棚卸し 2026-09-17: 行のまま持って `split("|")` していたので列がずれ、
  /// 記号がそのまま載っていた）
  | { kind: "table"; rows: Run[][][] };

/// スライドに載せる画像。**説明も持つ**（CFG-72 の見出しに使う）。
export type SlideImage = { url: string; alt: string };

export type Slide = {
  /// `section` は扉（題だけの 1 枚）。2 つ目以降の `#` がこれになる
  kind: "content" | "section";
  title: string;
  blocks: SlideBlock[];
  /// 右側に置く画像のパス。**本文とは分ける**（並びに混ぜない）。
  images: SlideImage[];
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

// 下線の見出し（setext: `題\n===`）も見出しとして割る（24-5。HTML と Word は見出しに
// するのに、PowerPoint だけ `#` の形しか見ておらず、下線の見出しが消えていた）
const HEADING = /^(?:ATX|Setext)Heading(\d)$/;
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

/// 何番目の見出しでスライドを分けるか（CFG-40。既定は 2 = `##`）。
///
/// **浅い見出しは扉、同じ深さは本文の枚、深い見出しは枚の中の小見出し**。
/// この 1 本の規則で 1 / 2 / 3 のどれでも同じように割れる。
export type SplitLevel = 1 | 2 | 3;

/// `:::` の囲み（`:::note` / `:::details` / `:::center` / `:::right`）の開きと
/// 閉じの行を、同じ長さの空白に置き換える（22-P。寄せの囲みは 22-1 から）。スライドの解析（Lezer）は囲みを知らず、`:::note warn 注意 :::` が
/// 1 つの段落として字のまま PowerPoint に出ていた。空白の行は空行なので、中身は
/// 前後と別の段落になる（HTML 書き出しの markdown-it-container と同じ切れ方）。
/// 長さを保つので、本文の中の位置はずれない。コード・数式ブロックの中の `:::` は
/// 囲みにしない（見つけ方は lib/container-lines。HTML 書き出しと同じ）
function withoutContainerLines(text: string): {
  text: string;
  /// 寄せの囲みの中身の範囲（書き換えたあとの本文の中の位置）
  aligns: { kind: SlideAlign; from: number; to: number }[];
} {
  const { lines, containers } = containersOf(text);
  if (containers.length === 0) return { text, aligns: [] };
  for (const { kind, info, open, close, inline } of containers) {
    if (inline) {
      // 1 行の形（`<p align="center">題</p>`。23-2 後半）: 中身だけを残す
      lines[open] = lines[open].slice(inline.from, inline.to);
      continue;
    }
    // 折りたたみの呼び名は太字の段落として残す（24-5。HTML と同じ。以前は開きの
    // 行ごと空白にして消えていた）。記号は逃がす（`#` で見出しにならないように）。
    // 前後に空行を置く — 前に無いと、すぐ上の段落の続きになった（25-3。HTML では
    // 囲みが段落を切る）
    lines[open] =
      kind === "details"
        ? `\n**${escapeMarkdown(info || DEFAULT_SUMMARY)}**\n`
        : " ".repeat(lines[open].length);
    lines[close] = " ".repeat(lines[close].length);
  }
  // 寄せの範囲は書き換えたあとの行から数える（呼び名の行で長さが変わる）
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const aligns: { kind: SlideAlign; from: number; to: number }[] = [];
  for (const { kind, open, close, inline } of containers) {
    if (kind !== "center" && kind !== "right") continue;
    aligns.push(
      inline
        ? {
            kind,
            from: starts[open],
            to: starts[open] + lines[open].length + 1,
          }
        : { kind, from: starts[open + 1], to: starts[close] },
    );
  }
  return { text: lines.join("\n"), aligns };
}

/// Markdown の記号（ASCII の約物）を逃がす。呼び名などを字のまま段落に置くため
function escapeMarkdown(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, (char) => `\\${char}`);
}

export function splitDeck(source: string, splitLevel: SplitLevel = 2): Deck {
  // XML が許さない制御文字を入口で落とす（24-4。貼った U+000B で壊れた PowerPoint に
  // なった）。枚の中の字はすべてここから作る
  // front matter も本文として読まない（HTML・Word と同じ。24-5）。読むと YAML の
  // コメント行が表紙の題になり、リストや空行を含むものは副題に入った。書体などの
  // 見た目は呼び手が front matter から別に読む（readSlideTheme）
  const { text, aligns } = withoutContainerLines(xmlSafeText(bodyText(source)));
  const tree = parser.parse(text);
  // その位置の寄せ（段落と小見出しにだけ使う。決定 4）
  const alignAt = (pos: number): { align?: SlideAlign } => {
    const found = aligns.find((range) => range.from <= pos && pos < range.to);
    return found ? { align: found.kind } : {};
  };
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
      // 枚が替わる見出しで寄せの囲みも切れる（ADR-0069 の決定 4。囲みの中に
      // `##` を書いたら、そこから先は寄せない）
      if (level <= splitLevel) {
        for (const range of aligns) {
          if (range.from <= node.from && node.from < range.to) {
            range.to = node.from;
          }
        }
      }
      if (level === 1 && !deck.title) {
        deck.title = body;
      } else if (level < splitLevel) {
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
      } else if (level === splitLevel) {
        current = {
          kind: "content",
          title: body,
          blocks: [],
          images: [],
          notes: "",
        };
        deck.slides.push(current);
      } else {
        add({
          kind: "heading",
          runs: runsOf(text, node),
          ...alignAt(node.from),
        });
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
        if (current) add({ kind: "paragraph", runs, ...alignAt(node.from) });
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
          // 項目の中のコードは、項目のあとにコードの枠として置く（24-5。以前は
          // 項目の字からも外し、コードの枠にもしないので黙って消えた）
          for (
            let child = item.node.firstChild;
            child;
            child = child.nextSibling
          ) {
            if (child.name === "FencedCode" || child.name === "CodeBlock") {
              add(listedCode(text, child));
            }
          }
        }
        break;
      case "FencedCode":
      case "CodeBlock":
        add(fencedCode(text, node));
        break;
      case "Table":
        add({ kind: "table", rows: tableRows(text, node) });
        break;
      default:
        break;
    }
  }
  deck.subtitle = subtitle.join("\n");
  return deck;
}

/// 横並びの箱（TASKS 5-4）。小見出しごとに 1 つ。
export type Card = { heading: Run[]; blocks: SlideBlock[]; align?: SlideAlign };

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
      cards.push({
        heading: block.runs,
        blocks: [],
        ...(block.align ? { align: block.align } : {}),
      });
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
  if (node.name === "CodeBlock") {
    // 字下げのコード。Lezer は 1 行ずつ別の CodeText に分けるので、最初の 1 つだけ
    // 読むと 2 行目以降が黙って消えた（24-4）。行の範囲から字下げ（空白 4 つか
    // タブ 1 つ）を外して読む。空行もそのまま残す
    const start = text.lastIndexOf("\n", node.from - 1) + 1;
    const lines = text
      .slice(start, node.to)
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => line.replace(/^(?: {1,4}|\t)/, ""));
    return { kind: "code", text: lines.join("\n"), language: "" };
  }
  const info = node.getChild("CodeInfo");
  const body = node.getChild("CodeText");
  return {
    kind: "code",
    text: body ? text.slice(body.from, body.to) : "",
    language: info ? text.slice(info.from, info.to).trim() : "",
  };
}

/// タブの桁（CommonMark と同じく 4 桁ごとに止まる）
const TAB_STOP = 4;

/// 行の頭の `from`〜`to` の桁数（タブは次の止まりまで）
function columnsOf(line: string, from: number, to: number): number {
  let column = 0;
  for (let at = from; at < to; at += 1) {
    column =
      line[at] === "\t" ? column + TAB_STOP - (column % TAB_STOP) : column + 1;
  }
  return column;
}

/// 行の頭から `columns` 桁ぶんの空白とタブを外す。タブが境目をまたぐときは、
/// はみ出た桁を空白で残す（CommonMark と同じ読み方。27-1）
function stripColumns(line: string, columns: number): string {
  let column = 0;
  let at = 0;
  while (at < line.length && column < columns) {
    const char = line[at];
    if (char === " ") {
      column += 1;
    } else if (char === "\t") {
      const next = column + TAB_STOP - (column % TAB_STOP);
      if (next > columns)
        return " ".repeat(next - columns) + line.slice(at + 1);
      column = next;
    } else {
      break;
    }
    at += 1;
  }
  return line.slice(at);
}

/// 項目の中身が始まる桁（印のあとの空白 1〜4 桁まで。5 桁以上なら印 + 1 桁）
function contentColumn(text: string, item: SyntaxNode): number {
  const mark = item.getChild("ListMark");
  const lineStart = text.lastIndexOf("\n", item.from - 1) + 1;
  const line = text.slice(lineStart, text.indexOf("\n", item.from) >>> 0);
  if (!mark) return columnsOf(line, 0, item.from - lineStart);
  const markEnd = mark.to - lineStart;
  const markColumn = columnsOf(line, 0, markEnd);
  let after = markEnd;
  while (line[after] === " " || line[after] === "\t") after += 1;
  const gap = columnsOf(line, 0, after) - markColumn;
  // 印のあとが空（空の項目）か 5 桁以上なら、中身は印 + 1 桁から（残りは字下げのコード）
  return gap === 0 || gap > 4 || after >= line.length
    ? markColumn + 1
    : markColumn + gap;
}

/// リストの項目の中のコード。**行の範囲から読み、どの行からも字下げを桁で外す**
/// （25-1。リストの中では Lezer がコードを 1 行ずつ別の CodeText に分けるので、
/// 最初の 1 つだけ読むと 2 行目から後ろが黙って消えた）。
/// - フェンス: 開きのフェンスの桁まで外す（それより深いぶんはコードの字下げ）
/// - 字下げのコード: 項目の中身の桁 + 4 桁を外す（25-3）
///
/// 字の数ではなく**桁で**数える。タブは 4 桁なので、項目の字下げ（2 桁）より深い
/// タブは、超えたぶんをコードの字下げとして残す（27-1。HTML と同じ）
function listedCode(text: string, node: SyntaxNode): SlideBlock {
  const block = fencedCode(text, node);
  if (block.kind !== "code") return block;
  const lineStart = text.lastIndexOf("\n", node.from - 1) + 1;
  let from: number;
  let to: number;
  let columns: number;
  if (node.name === "CodeBlock") {
    from = lineStart;
    to = node.to;
    const item = node.parent;
    columns =
      (item?.name === "ListItem" ? contentColumn(text, item) : 0) + TAB_STOP;
  } else {
    const opened = text.indexOf("\n", node.from);
    if (opened < 0 || opened >= node.to) return { ...block, text: "" };
    from = opened + 1;
    // 閉じていれば、閉じのフェンスの行の手前まで
    const marks = node.getChildren("CodeMark");
    to =
      marks.length >= 2
        ? text.lastIndexOf("\n", marks[marks.length - 1].from - 1)
        : node.to;
    if (to < from) return { ...block, text: "" };
    columns = columnsOf(
      text.slice(lineStart, node.from),
      0,
      node.from - lineStart,
    );
  }
  return {
    ...block,
    text: text
      .slice(from, to)
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => stripColumns(line, columns))
      .join("\n"),
  };
}

/// 画像だけの段落ならその URL。違えば null。
function imageOnly(text: string, node: SyntaxNode): SlideImage | null {
  const body = text.slice(node.from, node.to).trim();
  const image = node.firstChild;
  if (!image || image.name !== "Image") return null;
  if (text.slice(image.from, image.to).trim() !== body) return null;
  const url = image.getChild("URL");
  if (!url) return null;
  // `![説明](道)` の説明。`|300` の大きさ指定は説明ではない（6-8）
  const marks = image.getChildren("LinkMark");
  const raw = marks.length >= 2 ? text.slice(marks[0].to, marks[1].from) : "";
  return {
    url: text.slice(url.from, url.to),
    alt: splitImageAlt(raw).alt,
  };
}

/// 逃がし（`\*`）と文字参照（`&amp;`）を字に戻す。HTML 書き出しと同じ markdown-it の
/// 規則を使う（自前の表を持つと、戻せる文字参照が HTML と食い違う）
let unescaper: ((raw: string) => string) | null = null;
function unescapeInline(raw: string): string {
  if (!unescaper) {
    const md = new MarkdownIt();
    unescaper = (value) => md.utils.unescapeAll(value);
  }
  return unescaper(raw);
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
  // 色の span（ADR-0061）: 開きで色を積み、対になる閉じで降ろす。タグは出さない
  const colorStack: number[] = []; // 積んだときの styles の深さ
  node.cursor().iterate(
    (child) => {
      if (++entered === 1) return true;
      if (child.name === "HTMLTag") {
        const tag = text.slice(child.from, child.to);
        emit(child.from);
        pos = Math.max(pos, child.to);
        const style = spanStyleOf(tag);
        if (style !== null) {
          const parsed = parseColorSpan(style);
          const hex = parsed?.color ? hexForPptx(parsed.color) : undefined;
          styles.push(hex ? { text: "", color: hex } : { text: "" });
          colorStack.push(styles.length);
        } else if (isSpanClose(tag) && colorStack.length > 0) {
          styles.length = colorStack.pop()! - 1;
        }
        return false;
      }
      // 自動リンク `<https://…>`: URL を字として残し、リンクにする（24-5。以前は
      // URL を記号として捨てて字が消えた）
      if (child.name === "Autolink") {
        emit(child.from);
        const url = child.node.getChild("URL");
        if (url) {
          const target = text.slice(url.from, url.to);
          // メールアドレスは mailto: にする（25-3。HTML と同じ。付けないと
          // PowerPoint は相対の道として開こうとする）
          const link =
            target.includes("@") && !/^[a-z][a-z0-9+.-]*:/i.test(target)
              ? `mailto:${target}`
              : target;
          runs.push({ text: target, ...style(), link });
        }
        pos = Math.max(pos, child.to);
        return false;
      }
      // 逃がし `\*` と文字参照 `&amp;`: HTML と同じ字に戻す（24-5）
      if (child.name === "Escape" || child.name === "Entity") {
        emit(child.from);
        const raw = text.slice(child.from, child.to);
        runs.push({ text: unescapeInline(raw), ...style() });
        pos = Math.max(pos, child.to);
        return false;
      }
      // `\` の改行: ふつうの改行と同じに扱う（24-5。以前は `\` が字で残った）
      if (child.name === "HardBreak") {
        emit(child.from);
        runs.push({ text: "\n", ...style() });
        pos = Math.max(pos, child.to);
        return false;
      }
      // リンクと画像の URL から後ろ（題 `"ttl"` と閉じ）は本文に出さない（24-5。
      // 以前は題が本文に出た。文の中の画像も同じ = 25-3）
      const owner = child.node.parent;
      if (
        child.name === "URL" &&
        owner &&
        (owner.name === "Link" || owner.name === "Image")
      ) {
        emit(child.from);
        pos = Math.max(pos, owner.to);
        return false;
      }
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

/// 表の行をセルごとの run にする。区切り行（TableDelimiter）は形式の飾りで
/// 中身を持たない。セルの境目は**字面の縦棒**で見る（Lezer は中身の無い
/// セルに TableCell ノードを作らないので、ノードだけ数えると列がずれる。
/// `\|` は区切りにしない = GFM のリテラルなパイプ）
function tableRows(text: string, table: SyntaxNode): Run[][][] {
  const rows: Run[][][] = [];
  for (
    let row: SyntaxNode | null = table.firstChild;
    row;
    row = row.nextSibling
  ) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    const cells = row.getChildren("TableCell");
    const width = rows[0]?.length;
    rows.push(
      squareTo(
        width,
        cellRanges(text, row.from, row.to).map((range) => {
          const cell = cells.find(
            (found) => found.from >= range.from && found.to <= range.to,
          );
          if (!cell) return [];
          return runsOf(text, cell).map((run) => ({
            ...run,
            text: run.text.replace(/\\\|/g, "|"),
          }));
        }),
      ),
    );
  }
  return rows;
}

/// 列数を見出しの行に揃える（GFM: 多い分は切り、足りない分は空のセル）。
/// pptxgenjs は列の数を 1 行目から数えるので、揃えないと tc と gridCol の数が
/// 食い違う XML になる（レビュー 2026-09-24 / 21-3）
function squareTo(width: number | undefined, cells: Run[][]): Run[][] {
  if (width === undefined) return cells;
  if (cells.length > width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => [])];
}

/// 行の中のセルの範囲（先頭・末尾の縦棒の外は数えない。`\|` は区切りでない）
function cellRanges(
  text: string,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const line = text.slice(from, to);
  const pipes: number[] = [];
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "|" && line[index - 1] !== "\\") pipes.push(index);
  }
  if (pipes.length === 0) return [];
  const start = line.search(/\S/);
  const end = line.replace(/\s+$/, "").length;
  const bounds = [...pipes];
  if (pipes[0] !== start) bounds.unshift(start - 1);
  if (pipes[pipes.length - 1] !== end - 1) bounds.push(end);
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index + 1 < bounds.length; index++) {
    ranges.push({
      from: from + bounds[index] + 1,
      to: from + bounds[index + 1],
    });
  }
  return ranges;
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
    if (last && sameStyle(last, run)) last.text += run.text;
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
  // HTMLTag: 見出しの色 span は本文側では色になるが、題では生の `<span …>` が
  // 載っていた（レビュー 2026-09-24 / 21-3）。題は装飾を持たないので落とす
  const skip = new Set([
    "BulletList",
    "OrderedList",
    "FencedCode",
    "CodeBlock",
    "HTMLTag",
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

/// Mermaid の図を指す画像の url の頭。`mermaid:<ソース>` の形で、書き出し側が
/// 描いた PNG と突き合わせる（ファイルではないので resolveImage で見分ける）。
export const MERMAID_IMAGE_PREFIX = "mermaid:";

/// Mermaid のコードブロックを図（画像）に置き換える（要望 2026-09-08）。
/// 画像と同じ置き方（横の用紙では本文の右）になる。**描けなかった図は
/// コードのまま残す** — 何も出ないより、コードが見えるほうがよい。
export function diagramsAsImages(
  deck: Deck,
  canDraw: (source: string) => boolean = () => true,
): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide) => {
      if (slide.kind !== "content") return slide;
      const images = [...slide.images];
      const blocks = slide.blocks.filter((block) => {
        if (block.kind !== "code" || block.language !== "mermaid") return true;
        if (!canDraw(block.text)) return true;
        images.push({ url: `${MERMAID_IMAGE_PREFIX}${block.text}`, alt: "" });
        return false;
      });
      return { ...slide, blocks, images };
    }),
  };
}

/// デッキの中のコードの塊（言語と本文）。書き出しの前に字句の色分けを
/// 済ませるために使う（TASKS 12-12）
export function codeBlocksOf(deck: Deck): { language: string; text: string }[] {
  const found: { language: string; text: string }[] = [];
  for (const slide of deck.slides) {
    for (const block of slide.blocks) {
      if (block.kind === "code") {
        found.push({ language: block.language, text: block.text });
      }
    }
  }
  return found;
}
