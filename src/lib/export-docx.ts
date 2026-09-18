// Word（.docx）書き出し（ADR-0059 / TASKS 12-8）。
//
// HTML 書き出しと**同じ解析**（export-html の markdownTokens）から docx を組む。
// 見た目は「既定のまま綺麗」（ADR-0046 の考え方）: Word 側の見出しスタイル
// （Heading 1〜）に**割り当てる**ので、受け取った人が目次やナビゲーションを
// 使える。数式は MathML → OMML が要るので元の LaTeX を等幅で置く。Mermaid は
// PNG（PowerPoint と同じ経路）。設定タブは作らない。

import { frontMatterRange } from "../markdown/front-matter";
import { splitFenceInfo } from "../markdown/fence-info";
import { markdownTokens } from "./export-html";
import { inlinePieces } from "./export-runs";

/// markdown-it のトークン（export-html と同じ型を使う。@types の方と attrs の形が違う）
type Token = ReturnType<typeof markdownTokens>[number];

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

/// 番号付けの定義の名前。開始値が 1 でないものは別の定義にする
function numbersReference(start: number): string {
  return start === 1 ? NUMBERS : `${NUMBERS}-${start}`;
}

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
    size?: { width?: number; height?: number },
  ) => {
    const found = await imageBytes(url, resolve);
    if (!found) return null;
    // `![a|100](…)` の大きさ（6-8）。幅だけなら形なりに縮める（HTML と同じ）
    const width = size?.width ?? found.width;
    const height =
      size?.height ??
      (size?.width
        ? Math.max(1, Math.round((found.height * size.width) / found.width))
        : found.height);
    return new ImageRun({
      type: "png",
      data: found.data,
      transformation: { width, height },
    });
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

  type DocxRun =
    | InstanceType<typeof TextRun>
    | InstanceType<typeof ExternalHyperlink>
    | InstanceType<typeof ImageRun>;
  /// 行内の装飾は Run（markdown/runs）に落としてから Word の run にする
  /// （ADR-0068。以前はここで style stack を持っていた）
  const runsOf = async (inline: Token): Promise<DocxRun[]> => {
    const out: DocxRun[] = [];
    for (const piece of inlinePieces(inline)) {
      if (piece.kind === "break") {
        out.push(new TextRun({ break: 1 }));
        continue;
      }
      if (piece.kind === "image") {
        const run = await imageRun(piece.src, options.resolveImage, {
          width: piece.width,
          height: piece.height,
        });
        if (run) out.push(run);
        continue;
      }
      const { run } = piece;
      if (run.link) {
        out.push(
          new ExternalHyperlink({
            link: run.link,
            children: [
              new TextRun({
                text: run.text,
                style: "Hyperlink",
                bold: run.bold,
              }),
            ],
          }),
        );
        continue;
      }
      out.push(
        new TextRun({
          text: run.text,
          bold: run.bold,
          italics: run.italic,
          strike: run.strike,
          color: run.color,
          highlight: run.highlight ? "yellow" : undefined,
          font: run.code ? { name: mono } : body ? { name: body } : undefined,
          shading: run.code
            ? { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" }
            : undefined,
        }),
      );
    }
    return out;
  };

  const paragraphFor = async (
    inline: Token | null,
    extra: { heading?: HeadingValue; prefix?: string } = {},
  ): Promise<InstanceType<typeof Paragraph>> => {
    const list = listStack[listStack.length - 1];
    return new Paragraph({
      heading: extra.heading,
      children: [
        ...(extra.prefix ? [new TextRun({ text: extra.prefix })] : []),
        ...(inline ? await runsOf(inline) : []),
      ],
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
  // 脚注の本文（`[^1]: …`）の最初の段落に付ける番号。本文側の `[1]` と対にする
  let footnoteLabel: string | null = null;
  // 番号付きの開始値ごとに numbering の定義を分ける（`3.` から始める）
  const orderedStarts = new Set<number>();

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
          children.push(
            await paragraphFor(
              pendingInline,
              footnoteLabel ? { prefix: `[${footnoteLabel}] ` } : {},
            ),
          );
          footnoteLabel = null;
        }
        listItemFresh = false;
        pendingInline = null;
        break;
      case "footnote_open":
        footnoteLabel = String(
          token.meta?.label ?? Number(token.meta?.id ?? 0) + 1,
        );
        break;
      case "footnote_close":
        footnoteLabel = null;
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
      case "ordered_list_open": {
        numberInstance += 1;
        const start = Number(token.attrGet("start") ?? 1) || 1;
        orderedStarts.add(start);
        listStack.push({
          reference: numbersReference(start),
          instance: numberInstance,
        });
        break;
      }
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
        // ファイル名（` ```js:index.js `）は画面にも書き出しにも出す（ADR-0008）
        const { fileName } = splitFenceInfo(token.info?.trim() ?? "");
        if (fileName) {
          children.push(
            new Paragraph({
              shading: {
                type: ShadingType.CLEAR,
                fill: CODE_FILL,
                color: "auto",
              },
              children: [
                new TextRun({
                  text: fileName,
                  font: { name: mono },
                  bold: true,
                }),
              ],
              spacing: { before: 0, after: 0 },
            }),
          );
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
        // 開始値ごとに定義を分ける（`3.` から始めた並びは 3 から。1 は既定）
        ...[...new Set([1, ...orderedStarts])].map((start) => ({
          reference: numbersReference(start),
          levels: LEVELS.map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            ...(level === 0 && start !== 1 ? { start } : {}),
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        })),
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBase64String(doc);
}
