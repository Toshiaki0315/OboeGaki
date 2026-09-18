// Word（.docx）書き出し（ADR-0059 / TASKS 12-8）。
//
// HTML 書き出しと**同じ解析**（export-html の markdownTokens）から docx を組む。
// 見た目は「既定のまま綺麗」（ADR-0046 の考え方）: Word 側の見出しスタイル
// （Heading 1〜）に**割り当てる**ので、受け取った人が目次やナビゲーションを
// 使える。数式は MathML → OMML が要るので元の LaTeX を等幅で置く。Mermaid は
// PNG（PowerPoint と同じ経路）。設定タブは作らない。

import { frontMatterRange } from "../markdown/front-matter";
import { BULLETS, DocxEmitter, numbersReference } from "./docx-blocks";
import { markdownTokens } from "./export-html";

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
const LEVELS = [0, 1, 2, 3, 4, 5];

/// front matter の `title:`（Word の表題に使う）
function frontMatterTitle(markdownText: string): string | null {
  const range = frontMatterRange(markdownText);
  if (!range) return null;
  const head = markdownText.slice(0, range.bodyStart);
  const found = /^title:\s*["']?(.+?)["']?\s*$/m.exec(head);
  return found ? found[1].trim() : null;
}

export async function buildDocx(
  markdownText: string,
  options: DocxOptions,
): Promise<string> {
  // docx は大きいので書き出すときだけ読む（pptxgenjs と同じ手口）
  const mods = await import("docx");
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    LevelFormat,
    Packer,
    Paragraph,
    TextRun,
  } = mods;
  const body = options.bodyFont?.trim() || undefined;
  // ブロックの組み立ては docx-blocks（トークン → Word のオブジェクト）
  const emitter = new DocxEmitter({
    mods,
    resolveImage: options.resolveImage,
    diagrams: options.diagrams,
    mono: options.monoFont?.trim() || MONO_FALLBACK,
    body,
  });
  const title = frontMatterTitle(markdownText);
  if (title) {
    emitter.children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun(title)],
      }),
    );
  }
  for (const token of markdownTokens(markdownText, options.embeds)) {
    await emitter.emit(token);
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
        ...[...new Set([1, ...emitter.orderedStarts])].map((start) => ({
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
    sections: [{ children: emitter.children }],
  });
  return Packer.toBase64String(doc);
}
