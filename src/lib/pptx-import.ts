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
// | タイトル枠が無ければ、いちばん大きい字の短い枠 | `##`（要望 2026-10-01） |
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
  slides.forEach((slide, index) => {
    const heading = normalizeText(slide.title).trim();
    const blocks: string[] = [];
    for (const shape of slide.shapes) {
      blocks.push(...shapeBlocks(shape));
    }
    const notes = normalizeText(slide.notes).trim();
    if (heading) parts.push(`## ${heading}`);
    // 題が無くても 1 枚は 1 枚（要望 2026-10-01）。`##` が無いと書き出すときに
    // 前のスライドへ混ざり、枚数が減る。仮の題を置き、手で直してもらう
    else if (blocks.length > 0 || notes) parts.push(`## スライド ${index + 1}`);
    parts.push(...blocks);
    if (notes) {
      parts.push(
        notes
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
    }
  });
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
  // セルの縦棒は逃がす（CSV の取り込みと同じ。24-5）。逃がさないと列の数が区切り行と
  // 合わず、表ごと段落に崩れた
  const cells = rows.map((row) =>
    row.map((cell) => normalizeText(cell).trim().replace(/\|/g, "\\|")),
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
  return mergeRuns(paragraph.runs)
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

/// 書式の同じ隣り合う run をまとめる（24-5）。実際の .pptx は、言語や校正の印の違い
/// だけで同じ太字が細かく割れる。1 つずつ囲むと `**太字****続き**` になり、`****` が
/// 字のまま出た
function mergeRuns(runs: readonly ImportedRun[]): ImportedRun[] {
  const merged: ImportedRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.mono === run.mono) {
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
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

/// 段落を 1 行の題にする。行の境目に空白を挟むのは**英数字どうしのときだけ**
/// （「課題への個別対応は」+「「モグラ叩き」になる」に空白を入れない）
function titleText(paragraphs: readonly ImportedParagraph[]): string {
  const lines = paragraphs
    .map((paragraph) =>
      paragraph.runs
        .map((run) => run.text)
        .join("")
        .trim(),
    )
    .filter(Boolean);
  return lines.reduce(
    (joined, line) =>
      !joined
        ? line
        : /[\x21-\x7e]$/.test(joined) && /^[\x21-\x7e]/.test(line)
          ? `${joined} ${line}`
          : `${joined}${line}`,
    "",
  );
}

/// 題とみなす枠の字数の上限（2 行に折った題まで入る長さ）
const MAX_TITLE_LENGTH = 60;

/// 題の候補になる文字の枠。字の大きさ（sz。1/100 pt）と上からの位置
type TitleCandidate = { index: number; text: string; size: number; y: number };

/// タイトル枠（placeholder）が無いスライドの題を決める（要望 2026-10-01）。
///
/// 生成した資料などは題をただの文字の枠で置いている。**いちばん大きい字の、短い
/// 枠**を題とみなす（同じ大きさなら上にある方）。章の扉の大きな「1」のような
/// 番号だけの枠と、長い文は題にしない。字の大きさが書いていなければ決めない
/// （当てずっぽうで本文を題にしない。今までどおり `##` 無し）
function guessTitle(
  candidates: readonly TitleCandidate[],
): TitleCandidate | null {
  let best: TitleCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.size <= 0) continue;
    if (
      !best ||
      candidate.size > best.size ||
      (candidate.size === best.size && candidate.y < best.y)
    ) {
      best = candidate;
    }
  }
  return best;
}

function parseSlide(xml: string, notesXml: string): ImportedSlide {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const slide: ImportedSlide = { title: "", shapes: [], notes: "" };
  const candidates: TitleCandidate[] = [];

  for (const shape of Array.from(doc.getElementsByTagName("p:sp"))) {
    const paragraphs = readParagraphs(shape);
    if (paragraphs.length === 0) continue;
    if (isTitle(shape)) {
      slide.title = titleText(paragraphs);
      continue;
    }
    // 枠の run が全部等幅ならコードブロックとして扱う
    const mono = paragraphs.every((paragraph) =>
      paragraph.runs.every((run) => run.mono || !run.text.trim()),
    );
    const text = titleText(paragraphs);
    const lines = paragraphs.filter((paragraph) =>
      paragraph.runs.some((run) => run.text.trim()),
    ).length;
    if (
      !mono &&
      text &&
      lines <= 2 &&
      text.length <= MAX_TITLE_LENGTH &&
      !/^\d+$/.test(text) &&
      !isPageNumber(text)
    ) {
      candidates.push({
        index: slide.shapes.length,
        text,
        size: largestSize(shape),
        y: Number(
          shape.getElementsByTagName("a:off")[0]?.getAttribute("y") ?? 0,
        ),
      });
    }
    slide.shapes.push({ kind: "text", paragraphs, mono });
  }
  if (!slide.title) {
    const guessed = guessTitle(candidates);
    if (guessed) {
      slide.title = guessed.text;
      slide.shapes.splice(guessed.index, 1); // 題は `##` に。本文に重ねて出さない
    }
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

/// 枠の中でいちばん大きい字（sz。1/100 pt）。書いていなければ 0
function largestSize(shape: Element): number {
  let largest = 0;
  for (const style of Array.from(shape.getElementsByTagName("a:rPr"))) {
    const size = Number(style.getAttribute("sz") ?? 0);
    if (size > largest) largest = size;
  }
  return largest;
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
