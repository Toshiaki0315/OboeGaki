// PowerPoint を読んで Markdown にする（TASKS 4-5 / F-3）。
//
// **ざっくり読んで手で直す**前提。元のレイアウト（配色・段組み・位置）は
// 復元しない。復元できるのは**中身**だけで、これは形式の側に情報が
// 残っていないため（参照実装 editor/pptx_import.py と同じ構え）。
//
// 手掛かりも参照実装のものを引き継ぐ:
//
// | 手掛かり | 使い道 |
// | --- | --- |
// | スライドのタイトル枠 | `##` |
// | `buNone`（行頭記号なし）で短い段落 | `###` |
// | 文の終わりの記号で終わる段落 | 本文。それ以外は `- ` |
// | 等幅フォント | コードブロック |
// | 太字の run | `**強調**` |
//
// **平文と第 1 階層の箇条書きは、形式の上では見分けが付かない。**
// PowerPoint の本文枠は既定で全段落に行頭記号が付くため。上の「文の終わりの
// 記号」はその埋め合わせで、外れることがあるが**目で見て直せる**。

export type ImportedRun = { text: string; bold: boolean; mono: boolean };

export type ImportedParagraph = {
  runs: ImportedRun[];
  /// 0 から始まる階層。
  level: number;
  /// 行頭記号を消してある段落（`buNone`）。
  bulletNone: boolean;
};

export type ImportedShape =
  | {
      kind: "text";
      paragraphs: ImportedParagraph[];
      /// 枠まるごとが等幅（コードブロックとして扱う）。
      mono?: boolean;
    }
  | { kind: "table"; rows: string[][] };

export type ImportedSlide = {
  title: string;
  shapes: ImportedShape[];
  notes: string;
};

// 取り込みの共通部（文字の正規化・ページ番号・見出しらしさ）は
// lib/imported.ts が持つ。**2 か所に置くと片方だけ直されてずれる**
// （PDF の取り込みと PowerPoint の取り込みで、同じ文字が違う形になる）。
import {
  isPageNumber,
  looksLikeHeading,
  normalizeText,
  SENTENCE_END,
} from "./imported";

// 箇条書き 1 段ぶんの字下げ（このアプリの既定）
const INDENT = "    ";

/// スライドの並びを Markdown にする。
///
/// **中身が無ければ空を返す**（題名だけのノートを作らせない）。
export function slidesToMarkdown(
  title: string,
  slides: ImportedSlide[],
): string {
  const parts: string[] = [];
  for (const slide of slides) {
    const heading = normalizeText(slide.title).trim();
    const blocks: string[] = [];
    for (const shape of slide.shapes) {
      blocks.push(...shapeBlocks(shape));
    }
    const notes = normalizeText(slide.notes).trim();
    if (heading) parts.push(`## ${heading}`);
    parts.push(...blocks);
    if (notes) {
      parts.push(
        notes
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    }
  }
  if (parts.length === 0) return "";
  return `# ${title}\n\n${parts.join("\n\n")}\n`;
}

function shapeBlocks(shape: ImportedShape): string[] {
  if (shape.kind === "table") return tableBlocks(shape.rows);
  const lines = shape.paragraphs.map((paragraph) =>
    normalizeText(paragraphText(paragraph)),
  );
  if (lines.every((line) => !line.trim())) return [];
  if (shape.mono) {
    // **中は触らない。** 字下げも記号もコードの一部
    const fence = "```";
    return [`${fence}\n${lines.join("\n").replace(/\s+$/, "")}\n${fence}`];
  }

  const blocks: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) {
      blocks.push(bullets.join("\n"));
      bullets = [];
    }
  };
  shape.paragraphs.forEach((paragraph, index) => {
    const line = lines[index].trim();
    if (!line || isPageNumber(line)) return;
    if (paragraph.bulletNone && looksLikeHeading(line)) {
      flush();
      blocks.push(`### ${line}`);
      return;
    }
    // **文の終わりの記号で終わるものを本文とする**（字下げされていれば
    // 書いた人が階層を意識しているので箇条書き）
    if (paragraph.level === 0 && SENTENCE_END.includes(line[line.length - 1])) {
      flush();
      blocks.push(line);
      return;
    }
    bullets.push(`${INDENT.repeat(paragraph.level)}- ${line}`);
  });
  flush();
  return blocks;
}

function tableBlocks(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const cells = rows.map((row) =>
    row.map((cell) => normalizeText(cell).trim()),
  );
  const header = `| ${cells[0].join(" | ")} |`;
  const divider = `| ${cells[0].map(() => "---").join(" | ")} |`;
  const body = cells.slice(1).map((row) => `| ${row.join(" | ")} |`);
  return [[header, divider, ...body].join("\n")];
}

/// run の書式を記号に戻して繋ぐ。
///
/// **等幅は段落の中に混ざる。** インラインコード（`` `AWS` ``）がそう
/// 書かれているので、枠ごとコードにせず記号で囲み直す。
function paragraphText(paragraph: ImportedParagraph): string {
  return paragraph.runs
    .map((run) => {
      if (!run.text.trim()) return run.text;
      const head = run.text.slice(
        0,
        run.text.length - run.text.trimStart().length,
      );
      const tail = run.text.slice(run.text.trimEnd().length);
      let body = run.text.trim();
      if (run.mono) body = `\`${body}\``;
      if (run.bold) body = `**${body}**`;
      return `${head}${body}${tail}`;
    })
    .join("");
}

// ------------------------------------------------------------ .pptx を読む

/// 等幅として扱うフォント名（小文字で部分一致）。コードブロックの手掛かり。
const MONO_FONTS = [
  "consolas",
  "menlo",
  "monaco",
  "courier",
  "mono",
  "source code",
  "sf mono",
];

/// `.pptx` のバイト列からスライドの並びを取り出す。
///
/// **読めなければ空。** 1 つのスライドが読めなくても、そこだけ飛ばす
/// （取り込みを止めない）。
export async function readPptx(bytes: Uint8Array): Promise<ImportedSlide[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    // `slide10` が `slide2` より先に来ないよう番号で並べる
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: ImportedSlide[] = [];
  for (const name of names) {
    const xml = await zip.files[name].async("string");
    const notesName = name.replace(
      /^ppt\/slides\/slide(\d+)\.xml$/,
      "ppt/notesSlides/notesSlide$1.xml",
    );
    const notesXml = zip.files[notesName]
      ? await zip.files[notesName].async("string")
      : "";
    slides.push(parseSlide(xml, notesXml));
  }
  return slides;
}

function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function parseSlide(xml: string, notesXml: string): ImportedSlide {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const slide: ImportedSlide = { title: "", shapes: [], notes: "" };

  for (const shape of Array.from(doc.getElementsByTagName("p:sp"))) {
    const paragraphs = readParagraphs(shape);
    if (paragraphs.length === 0) continue;
    if (isTitle(shape)) {
      slide.title = paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
        .join(" ")
        .trim();
      continue;
    }
    slide.shapes.push({
      kind: "text",
      paragraphs,
      // 枠の run が全部等幅ならコードブロックとして扱う
      mono: paragraphs.every((paragraph) =>
        paragraph.runs.every((run) => run.mono || !run.text.trim()),
      ),
    });
  }

  for (const table of Array.from(doc.getElementsByTagName("a:tbl"))) {
    const rows = Array.from(table.getElementsByTagName("a:tr")).map((row) =>
      Array.from(row.getElementsByTagName("a:tc")).map((cell) =>
        Array.from(cell.getElementsByTagName("a:t"))
          .map((node) => node.textContent ?? "")
          .join(""),
      ),
    );
    if (rows.length > 0) slide.shapes.push({ kind: "table", rows });
  }

  if (notesXml) {
    const notes = new DOMParser().parseFromString(notesXml, "application/xml");
    slide.notes = Array.from(notes.getElementsByTagName("a:p"))
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagName("a:t"))
          .map((node) => node.textContent ?? "")
          .join(""),
      )
      .filter((line) => line.trim() && !isPageNumber(line))
      .join("\n");
  }
  return slide;
}

function isTitle(shape: Element): boolean {
  return Array.from(shape.getElementsByTagName("p:ph")).some((holder) => {
    const type = holder.getAttribute("type") ?? "";
    return type === "title" || type === "ctrTitle";
  });
}

function readParagraphs(shape: Element): ImportedParagraph[] {
  return Array.from(shape.getElementsByTagName("a:p"))
    .map((paragraph) => {
      const properties = paragraph.getElementsByTagName("a:pPr")[0];
      return {
        runs: Array.from(paragraph.getElementsByTagName("a:r")).map((run) => {
          const style = run.getElementsByTagName("a:rPr")[0];
          const typeface =
            style
              ?.getElementsByTagName("a:latin")[0]
              ?.getAttribute("typeface") ?? "";
          return {
            text: run.getElementsByTagName("a:t")[0]?.textContent ?? "",
            bold: style?.getAttribute("b") === "1",
            mono: MONO_FONTS.some((name) =>
              typeface.toLowerCase().includes(name),
            ),
          };
        }),
        level: Number(properties?.getAttribute("lvl") ?? 0),
        bulletNone:
          (properties?.getElementsByTagName("a:buNone").length ?? 0) > 0,
      };
    })
    .filter((paragraph) => paragraph.runs.length > 0);
}

// 取り込みの共通部を、この入口からも使えるようにしておく
// （PowerPoint の取り込みを見ている人が探しに行かなくて済む）
export { isPageNumber, looksLikeHeading, normalizeText };
