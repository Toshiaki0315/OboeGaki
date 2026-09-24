// Word 書き出しのブロック（19-4 の残り）。`buildDocx` の中に 490 行の閉包として
// あった「トークン → Word の段落・表・画像」をここに分けた。1 トークンずつ
// `emit` に渡し、出来上がった `children` を Document に載せる。**入力は
// markdown-it のトークン、出力は docx のオブジェクト**で、Markdown の字面は見ない。
// docx は大きいので書き出すときだけ読む（呼ぶ側が `import("docx")` した結果を渡す）。
// 出来上がりは fixtures/golden/export-docx.*.xml が字面で見張る

import { splitFenceInfo } from "../markdown/fence-info";
import type { markdownTokens } from "./export-html";
import {
  decodeDataUrl,
  docxImageType,
  imageDimensions,
  type DocxImageType,
} from "./image-bytes";
import { inlinePieces } from "./export-runs";

/// markdown-it のトークン（export-html と同じ型を使う。@types の方と attrs の形が違う）
export type Token = ReturnType<typeof markdownTokens>[number];
/// `await import("docx")` の中身
export type DocxMods = typeof import("docx");

export const CODE_FILL = "F2F2F2";
export const MAX_IMAGE_WIDTH = 560; // px（A4 の本文幅ぐらい）
export const BULLETS = "oboegaki-bullets";
const NUMBERS = "oboegaki-numbers";

/// 番号付けの定義の名前。開始値が 1 でないものは別の定義にする
export function numbersReference(start: number): string {
  return start === 1 ? NUMBERS : `${NUMBERS}-${start}`;
}

/// PNG の大きさ（IHDR）。読めなければ 1 × 1 扱い
/// 画像の中身と大きさ（本文幅に収める）。Word に渡せる種類（PNG / JPEG / GIF /
/// BMP）でなければ null — WebP や SVG は呼び手（useExport）が PNG にしてから渡す
async function imageBytes(
  url: string,
  resolveImage: (url: string) => Promise<string | null>,
): Promise<{
  data: Uint8Array;
  type: DocxImageType;
  width: number;
  height: number;
} | null> {
  const dataUrl = await resolveImage(url);
  const decoded = dataUrl ? decodeDataUrl(dataUrl) : null;
  if (!decoded) return null;
  const type = docxImageType(decoded.mime);
  if (!type) return null;
  const { width, height } = imageDimensions(type, decoded.bytes) ?? {
    width: 1,
    height: 1,
  };
  const scale = width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / width : 1;
  return {
    data: decoded.bytes,
    type,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type DocxContext = {
  mods: DocxMods;
  /// 画像を data URL に（読めなければ null → 飛ばす）
  resolveImage: (url: string) => Promise<string | null>;
  /// Mermaid のソース → PNG の data URL（PowerPoint と同じ経路）
  diagrams?: Map<string, string>;
  /// 等幅と本文のフォント（本文は空なら Word の既定）
  mono: string;
  body?: string;
};

type Paragraph = InstanceType<DocxMods["Paragraph"]>;
type Table = InstanceType<DocxMods["Table"]>;
type TableRow = InstanceType<DocxMods["TableRow"]>;
type TableCell = InstanceType<DocxMods["TableCell"]>;
type HeadingValue = DocxMods["HeadingLevel"][keyof DocxMods["HeadingLevel"]];
type DocxRun =
  | InstanceType<DocxMods["TextRun"]>
  | InstanceType<DocxMods["ExternalHyperlink"]>
  | InstanceType<DocxMods["ImageRun"]>;

/// トークンを順に受けて、Word のブロックを積む
export class DocxEmitter {
  readonly children: (Paragraph | Table)[] = [];
  /// 番号付きの開始値ごとに numbering の定義を分ける（`3.` から始める）
  readonly orderedStarts = new Set<number>();

  // 箇条書きの入れ子と番号付けの区切り（番号は一覧ごとに 1 から）
  private listStack: { reference: string; instance: number }[] = [];
  private numberInstance = 0;
  private quoteDepth = 0;
  private embedDepth = 0;
  private inHeading: HeadingValue | undefined;
  private inTable: { rows: TableRow[]; cells: TableCell[] } | null = null;
  private pendingInline: Token | null = null;
  private listItemFresh = false;
  // 脚注の本文（`[^1]: …`）の最初の段落に付ける番号。本文側の `[1]` と対にする
  private footnoteLabel: string | null = null;
  private readonly headingOf: Record<string, HeadingValue>;

  constructor(private readonly ctx: DocxContext) {
    const { HeadingLevel } = ctx.mods;
    this.headingOf = {
      h1: HeadingLevel.HEADING_1,
      h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3,
      h4: HeadingLevel.HEADING_4,
      h5: HeadingLevel.HEADING_5,
      h6: HeadingLevel.HEADING_6,
    };
  }

  /// 画像（data URL → ImageRun）。`![a|100](…)` の大きさ（6-8）。幅だけなら
  /// 形なりに縮める（HTML と同じ）
  async imageRun(
    url: string,
    resolve: DocxContext["resolveImage"],
    size?: { width?: number; height?: number },
  ) {
    const found = await imageBytes(url, resolve);
    if (!found) return null;
    const width = size?.width ?? found.width;
    const height =
      size?.height ??
      (size?.width
        ? Math.max(1, Math.round((found.height * size.width) / found.width))
        : found.height);
    return new this.ctx.mods.ImageRun({
      type: found.type,
      data: found.data,
      transformation: { width, height },
    });
  }

  /// 行内の装飾は Run（markdown/runs）に落としてから Word の run にする（ADR-0068）
  async runsOf(inline: Token): Promise<DocxRun[]> {
    const { TextRun, ExternalHyperlink, ShadingType } = this.ctx.mods;
    const { mono, body } = this.ctx;
    const out: DocxRun[] = [];
    for (const piece of inlinePieces(inline)) {
      if (piece.kind === "break") {
        out.push(new TextRun({ break: 1 }));
        continue;
      }
      if (piece.kind === "image") {
        const run = await this.imageRun(piece.src, this.ctx.resolveImage, {
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
  }

  /// 段落。箇条書きの中なら番号付け、引用・埋め込みの中なら字下げ（引用は左の罫線）
  async paragraphFor(
    inline: Token | null,
    extra: { heading?: HeadingValue; prefix?: string } = {},
  ): Promise<Paragraph> {
    const { Paragraph, TextRun, BorderStyle } = this.ctx.mods;
    const list = this.listStack[this.listStack.length - 1];
    return new Paragraph({
      heading: extra.heading,
      children: [
        ...(extra.prefix ? [new TextRun({ text: extra.prefix })] : []),
        ...(inline ? await this.runsOf(inline) : []),
      ],
      numbering: list
        ? {
            reference: list.reference,
            level: Math.min(this.listStack.length - 1, 5),
            instance: list.instance,
          }
        : undefined,
      indent:
        !list && (this.quoteDepth > 0 || this.embedDepth > 0)
          ? { left: 720 * (this.quoteDepth + this.embedDepth) }
          : undefined,
      border:
        this.quoteDepth > 0
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
  }

  /// 1 トークンを受ける。閉じのトークンで段落を積む
  async emit(token: Token): Promise<void> {
    const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType } =
      this.ctx.mods;
    switch (token.type) {
      case "heading_open":
        this.inHeading = this.headingOf[token.tag];
        break;
      case "heading_close":
        this.children.push(
          await this.paragraphFor(this.pendingInline, {
            heading: this.inHeading,
          }),
        );
        this.pendingInline = null;
        this.inHeading = undefined;
        break;
      case "paragraph_open":
        break;
      case "paragraph_close":
        await this.closeParagraph();
        break;
      case "footnote_open":
        this.footnoteLabel = String(
          token.meta?.label ?? Number(token.meta?.id ?? 0) + 1,
        );
        break;
      case "footnote_close":
        this.footnoteLabel = null;
        break;
      case "inline":
        if (this.inTable) {
          this.inTable.cells.push(
            new TableCell({
              children: [new Paragraph({ children: await this.runsOf(token) })],
            }),
          );
        } else {
          this.pendingInline = token;
        }
        break;
      case "bullet_list_open":
        this.listStack.push({ reference: BULLETS, instance: 0 });
        break;
      case "ordered_list_open": {
        this.numberInstance += 1;
        const start = Number(token.attrGet("start") ?? 1) || 1;
        this.orderedStarts.add(start);
        this.listStack.push({
          reference: numbersReference(start),
          instance: this.numberInstance,
        });
        break;
      }
      case "bullet_list_close":
      case "ordered_list_close":
        this.listStack.pop();
        break;
      case "list_item_open":
        this.listItemFresh = true;
        break;
      case "list_item_close":
        this.listItemFresh = false;
        break;
      case "fence":
      case "code_block":
        await this.codeBlock(token);
        break;
      case "blockquote_open":
        this.quoteDepth += 1;
        break;
      case "blockquote_close":
        this.quoteDepth -= 1;
        break;
      case "embed_open":
        this.embedDepth += 1;
        break;
      case "embed_close":
        this.embedDepth -= 1;
        break;
      case "hr":
        this.children.push(
          new Paragraph({
            border: {
              bottom: {
                style: this.ctx.mods.BorderStyle.SINGLE,
                size: 6,
                color: "999999",
                space: 1,
              },
            },
          }),
        );
        break;
      case "table_open":
        this.inTable = { rows: [], cells: [] };
        break;
      case "tr_close":
        if (this.inTable) {
          this.inTable.rows.push(
            new TableRow({ children: this.inTable.cells }),
          );
          this.inTable.cells = [];
        }
        break;
      case "table_close":
        if (this.inTable) {
          this.children.push(
            new Table({
              rows: this.inTable.rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          this.inTable = null;
        }
        break;
      case "html_block":
        // 数式ブロック（元の LaTeX を等幅で）
        if (token.meta?.latex) {
          this.children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: String(token.meta.latex),
                  font: { name: this.ctx.mono },
                }),
              ],
              alignment: this.ctx.mods.AlignmentType.CENTER,
            }),
          );
        }
        break;
      case "details_open":
        if (token.info) {
          this.children.push(
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

  /// 段落の閉じ。表の中では何もしない（セルは inline で積んだ）
  private async closeParagraph(): Promise<void> {
    if (this.inTable) return;
    const { Paragraph } = this.ctx.mods;
    // 箇条書きの項目の 2 つ目以降の段落は、番号を付けずに字下げだけ
    if (this.listStack.length > 0 && !this.listItemFresh) {
      this.children.push(
        new Paragraph({
          children: this.pendingInline
            ? await this.runsOf(this.pendingInline)
            : [],
          indent: { left: 720 * this.listStack.length },
        }),
      );
    } else {
      this.children.push(
        await this.paragraphFor(
          this.pendingInline,
          this.footnoteLabel ? { prefix: `[${this.footnoteLabel}] ` } : {},
        ),
      );
      this.footnoteLabel = null;
    }
    this.listItemFresh = false;
    this.pendingInline = null;
  }

  /// コード。Mermaid は描けていれば絵（PowerPoint と同じ経路）、ファイル名は
  /// 画面にも書き出しにも出す（ADR-0008）。行ごとに地の色を敷いた段落
  private async codeBlock(token: Token): Promise<void> {
    const { Paragraph, TextRun, ShadingType, AlignmentType } = this.ctx.mods;
    const { mono } = this.ctx;
    const { lang, fileName } = splitFenceInfo(token.info?.trim() ?? "");
    const png =
      lang === "mermaid"
        ? this.ctx.diagrams?.get(token.content.trim())
        : undefined;
    if (png) {
      const run = await this.imageRun("mermaid", async () => png);
      if (run) {
        this.children.push(
          new Paragraph({ children: [run], alignment: AlignmentType.CENTER }),
        );
        return;
      }
    }
    const shaded = (children: InstanceType<DocxMods["TextRun"]>[]) =>
      new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" },
        children,
        spacing: { before: 0, after: 0 },
      });
    if (fileName) {
      this.children.push(
        shaded([
          new TextRun({ text: fileName, font: { name: mono }, bold: true }),
        ]),
      );
    }
    const lines = token.content.replace(/\n$/, "").split("\n");
    for (const line of lines) {
      this.children.push(
        shaded([new TextRun({ text: line || " ", font: { name: mono } })]),
      );
    }
  }
}
