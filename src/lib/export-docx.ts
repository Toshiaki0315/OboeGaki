// Word（.docx）書き出し（ADR-0059 / TASKS 12-8）。
//
// HTML 書き出しと**同じ解析**（export-html の markdownTokens）から docx を組む。
// 見た目は「既定のまま綺麗」（ADR-0046 の考え方）: Word 側の見出しスタイル
// （Heading 1〜）に**割り当てる**ので、受け取った人が目次やナビゲーションを
// 使える。数式は MathML → OMML が要るので元の LaTeX を等幅で置く。Mermaid は
// PNG（PowerPoint と同じ経路）。設定タブは作らない。

import { frontMatterRange } from "../editor/frontmatter";
import { splitFenceInfo } from "../editor/code-blocks";
import { markdownTokens } from "./export-html";

/// markdown-it のトークン（export-html と同じ型を使う。@types の方と attrs の形が違う）
type Token = ReturnType<typeof markdownTokens>[number];
import { hexForPptx, parseColorSpan } from "./text-color";

export type DocxOptions = {
  /// 表題（front matter の title が無いときは使わない — H1 が題）
  title: string;
  /// 画像を data URL に（読めなければ null → 飛ばす）
  resolveImage: (url: string) => Promise<string | null>;
  /// Mermaid のソース → PNG の data URL（PowerPoint と同じ経路）
  diagrams?: Map<string, string>;
  /// 埋め込みの対象 → 本文（ADR-0058。展開する）
  embeds?: Map<string, string>;
  /// 本文と等幅のフォント。空なら Word の既定に任せる
  bodyFont?: string;
  monoFont?: string;
};

const MONO_FALLBACK = "Menlo";
const CODE_FILL = "F2F2F2";
const MAX_IMAGE_WIDTH = 560; // px（A4 の本文幅ぐらい）
const BULLETS = "oboegaki-bullets";
const NUMBERS = "oboegaki-numbers";
const LEVELS = [0, 1, 2, 3, 4, 5];

type Style = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  highlight?: boolean;
  link?: string;
};

/// front matter の `title:`（Word の表題に使う）
function frontMatterTitle(markdownText: string): string | null {
  const range = frontMatterRange(markdownText);
  if (!range) return null;
  const head = markdownText.slice(0, range.bodyStart);
  const found = /^title:\s*["']?(.+?)["']?\s*$/m.exec(head);
  return found ? found[1].trim() : null;
}

/// PNG の大きさ（IHDR）。読めなければ 1 × 1 扱い
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) return { width: 1, height: 1 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!/^data:image\/png;base64,/i.test(dataUrl) || comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/// 画像の中身と大きさ（本文幅に収める）。読めなければ null
async function imageBytes(
  url: string,
  resolveImage: DocxOptions["resolveImage"],
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const dataUrl = await resolveImage(url);
  const bytes = dataUrl ? dataUrlBytes(dataUrl) : null;
  if (!bytes) return null;
  const { width, height } = pngSize(bytes);
  const scale = width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / width : 1;
  return {
    data: bytes,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function buildDocx(
  markdownText: string,
  options: DocxOptions,
): Promise<string> {
  // docx は大きいので書き出すときだけ読む（pptxgenjs と同じ手口）
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");
  type HeadingValue = (typeof HeadingLevel)[keyof typeof HeadingLevel];
  const tokens = markdownTokens(markdownText, options.embeds);
  const mono = options.monoFont?.trim() || MONO_FALLBACK;
  const body = options.bodyFont?.trim() || undefined;
  const imageRun = async (
    url: string,
    resolve: DocxOptions["resolveImage"],
  ) => {
    const found = await imageBytes(url, resolve);
    return found
      ? new ImageRun({
          type: "png",
          data: found.data,
          transformation: { width: found.width, height: found.height },
        })
      : null;
  };
  const children: (
    InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  )[] = [];
  const title = frontMatterTitle(markdownText);
  if (title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun(title)],
      }),
    );
  }

  // 箇条書きの入れ子と番号付けの区切り（番号は一覧ごとに 1 から）
  const listStack: { reference: string; instance: number }[] = [];
  let numberInstance = 0;
  let quoteDepth = 0;
  let embedDepth = 0;

  type Run =
    | InstanceType<typeof TextRun>
    | InstanceType<typeof ExternalHyperlink>
    | InstanceType<typeof ImageRun>;
  const runsOf = async (inline: Token): Promise<Run[]> => {
    const out: Run[] = [];
    const stack: Style[] = [{}];
    const current = () => stack[stack.length - 1];
    const push = (patch: Style) => stack.push({ ...current(), ...patch });
    const pop = () => {
      if (stack.length > 1) stack.pop();
    };
    const text = (value: string, extra: Style = {}) => {
      const style = { ...current(), ...extra };
      const run = new TextRun({
        text: value,
        bold: style.bold,
        italics: style.italics,
        strike: style.strike,
        color: style.color,
        highlight: style.highlight ? "yellow" : undefined,
        font: style.code ? { name: mono } : body ? { name: body } : undefined,
        shading: style.code
          ? { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" }
          : undefined,
      });
      if (style.link) {
        out.push(
          new ExternalHyperlink({
            link: style.link,
            children: [
              new TextRun({
                text: value,
                style: "Hyperlink",
                bold: style.bold,
              }),
            ],
          }),
        );
      } else {
        out.push(run);
      }
    };
    for (const child of inline.children ?? []) {
      switch (child.type) {
        case "text":
          text(child.content);
          break;
        case "softbreak":
          text(" ");
          break;
        case "hardbreak":
          out.push(new TextRun({ break: 1 }));
          break;
        case "strong_open":
          push({ bold: true });
          break;
        case "em_open":
          push({ italics: true });
          break;
        case "s_open":
          push({ strike: true });
          break;
        case "mark_open":
          push({ highlight: true });
          break;
        case "link_open":
          push({ link: String(child.attrGet("href") ?? "") });
          break;
        case "color_span_open": {
          const parsed = parseColorSpan(String(child.attrGet("style") ?? ""));
          push({ color: parsed?.color ? hexForPptx(parsed.color) : undefined });
          break;
        }
        case "strong_close":
        case "em_close":
        case "s_close":
        case "mark_close":
        case "link_close":
        case "color_span_close":
          pop();
          break;
        case "code_inline":
          text(child.content, { code: true });
          break;
        case "html_inline":
          // 数式（元の LaTeX を等幅で）。他の生 HTML はここに来ない（html: false）
          if (child.meta?.latex) text(String(child.meta.latex), { code: true });
          break;
        case "image": {
          const run = await imageRun(
            String(child.attrGet("src") ?? ""),
            options.resolveImage,
          );
          if (run) out.push(run);
          break;
        }
        case "footnote_ref":
          text(
            `[${(child.meta?.label as string | undefined) ?? child.meta?.id ?? "*"}]`,
          );
          break;
        default:
          if (child.content) text(child.content);
      }
    }
    return out;
  };

  const paragraphFor = async (
    inline: Token | null,
    extra: { heading?: HeadingValue } = {},
  ): Promise<InstanceType<typeof Paragraph>> => {
    const list = listStack[listStack.length - 1];
    return new Paragraph({
      heading: extra.heading,
      children: inline ? await runsOf(inline) : [],
      numbering: list
        ? {
            reference: list.reference,
            level: Math.min(listStack.length - 1, 5),
            instance: list.instance,
          }
        : undefined,
      indent:
        !list && (quoteDepth > 0 || embedDepth > 0)
          ? { left: 720 * (quoteDepth + embedDepth) }
          : undefined,
      border:
        quoteDepth > 0
          ? {
              left: {
                style: BorderStyle.SINGLE,
                size: 12,
                color: "BFBFBF",
                space: 8,
              },
            }
          : undefined,
    });
  };

  let inHeading: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
  let inTable: {
    rows: InstanceType<typeof TableRow>[];
    cells: InstanceType<typeof TableCell>[];
  } | null = null;
  const headingOf: Record<
    string,
    (typeof HeadingLevel)[keyof typeof HeadingLevel]
  > = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
    h5: HeadingLevel.HEADING_5,
    h6: HeadingLevel.HEADING_6,
  };
  let pendingInline: Token | null = null;
  let listItemFresh = false;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    switch (token.type) {
      case "heading_open":
        inHeading = headingOf[token.tag];
        break;
      case "heading_close":
        children.push(
          await paragraphFor(pendingInline, { heading: inHeading }),
        );
        pendingInline = null;
        inHeading = undefined;
        break;
      case "paragraph_open":
        break;
      case "paragraph_close":
        if (inTable) break;
        // 箇条書きの項目の 2 つ目以降の段落は、番号を付けずに字下げだけ
        if (listStack.length > 0 && !listItemFresh) {
          const list = listStack[listStack.length - 1];
          children.push(
            new Paragraph({
              children: pendingInline ? await runsOf(pendingInline) : [],
              indent: { left: 720 * listStack.length },
            }),
          );
          void list;
        } else {
          children.push(await paragraphFor(pendingInline));
        }
        listItemFresh = false;
        pendingInline = null;
        break;
      case "inline":
        if (inTable) {
          inTable.cells.push(
            new TableCell({
              children: [new Paragraph({ children: await runsOf(token) })],
            }),
          );
        } else {
          pendingInline = token;
        }
        break;
      case "bullet_list_open":
        listStack.push({ reference: BULLETS, instance: 0 });
        break;
      case "ordered_list_open":
        numberInstance += 1;
        listStack.push({ reference: NUMBERS, instance: numberInstance });
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        listStack.pop();
        break;
      case "list_item_open":
        listItemFresh = true;
        break;
      case "list_item_close":
        listItemFresh = false;
        break;
      case "fence":
      case "code_block": {
        const { lang } = splitFenceInfo(token.info?.trim() ?? "");
        const png =
          lang === "mermaid"
            ? options.diagrams?.get(token.content.trim())
            : undefined;
        if (png) {
          const run = await imageRun("mermaid", async () => png);
          if (run) {
            children.push(
              new Paragraph({
                children: [run],
                alignment: AlignmentType.CENTER,
              }),
            );
            break;
          }
        }
        const lines = token.content.replace(/\n$/, "").split("\n");
        for (const line of lines) {
          children.push(
            new Paragraph({
              shading: {
                type: ShadingType.CLEAR,
                fill: CODE_FILL,
                color: "auto",
              },
              children: [
                new TextRun({ text: line || " ", font: { name: mono } }),
              ],
              spacing: { before: 0, after: 0 },
            }),
          );
        }
        break;
      }
      case "blockquote_open":
        quoteDepth += 1;
        break;
      case "blockquote_close":
        quoteDepth -= 1;
        break;
      case "embed_open":
        embedDepth += 1;
        break;
      case "embed_close":
        embedDepth -= 1;
        break;
      case "hr":
        children.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "999999",
                space: 1,
              },
            },
          }),
        );
        break;
      case "table_open":
        inTable = { rows: [], cells: [] };
        break;
      case "tr_close":
        if (inTable) {
          inTable.rows.push(new TableRow({ children: inTable.cells }));
          inTable.cells = [];
        }
        break;
      case "table_close":
        if (inTable) {
          children.push(
            new Table({
              rows: inTable.rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          inTable = null;
        }
        break;
      case "html_block":
        // 数式ブロック（元の LaTeX を等幅で）
        if (token.meta?.latex) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: String(token.meta.latex),
                  font: { name: mono },
                }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          );
        }
        break;
      case "details_open":
        if (token.info) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: String(token.info), bold: true })],
            }),
          );
        }
        break;
      default:
        break; // th/td/thead/tbody/tr_open・details_close・footnote_* は形だけ
    }
  }

  const doc = new Document({
    creator: "おぼえがき",
    title: title ?? options.title,
    styles: body
      ? { default: { document: { run: { font: body } } } }
      : undefined,
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: LEVELS.map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "◦", "▪"][level % 3],
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
        {
          reference: NUMBERS,
          levels: LEVELS.map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBase64String(doc);
}
