// PowerPoint への書き出し（TASKS 4-5 / F-5）。
//
// **ざっくり作って手で整える**前提。凝ったレイアウトは狙わない
// （参照実装 editor/pptx_export.py と同じ構え）。
//
// 割り方は lib/slides.ts（F-4）が決めていて、ここは組み立てだけを持つ。
// 置き方もユーザーと決めたものを引き継ぐ:
// **`#` は表紙、`##` ごとに 1 枚、画像は右側。**
//
// **書き出しは止めない。** 画像が読めなくても、そこだけ飛ばしてファイルを
// 作る。1 枚のリンク切れで書き出せないほうが困る。
//
// pptxgenjs は大きいので動的 import にする（図 = ADR-0037 と同じ）。

import {
  cardsOf,
  type Card,
  type Deck,
  type Run,
  type SlideBlock,
} from "./slides";
import { DEFAULT_SLIDE_THEME, type SlideTheme } from "./slide-theme";
import { applyThemeParts, themeParts, type ThemeParts } from "./slide-template";

// スライドの大きさ（16:9）。既定の 4:3 は今どき狭い
const LAYOUT = { name: "OBOEGAKI_16x9", width: 13.333, height: 7.5 };
const MARGIN = 0.6;
const BODY_TOP = 1.8;
/// 画像があるときの本文の幅（全体に対する割合）。残りが画像の場所になる
const BODY_RATIO_WITH_IMAGE = 0.52;
const TITLE_POINTS = 30;
const BODY_POINTS = 17;
const HEADING_POINTS = 19;
const CODE_POINTS = 13;
const TABLE_POINTS = 13;
/// PowerPoint の箇条書きは 0〜8 段
const MAX_LEVEL = 8;
/// 共通の体裁の名前（スライド番号とフッタを載せる）
const MASTER = "OBOEGAKI_MASTER";

/// 画像を data URL へ解決する（読めなければ null）。vault を知っている
/// 呼び出し側の仕事。
export type ImageResolver = (url: string) => Promise<string | null>;

/// デッキを `.pptx` にして base64 で返す。
export async function buildPptx(
  deck: Deck,
  resolveImage: ImageResolver,
  /// ノートの front matter から読んだ見た目（TASKS 5-5）
  theme: SlideTheme = DEFAULT_SLIDE_THEME,
  /// テンプレートから借りた配色と書体（TASKS 5-6 / ADR-0045 案 A）
  borrowed: ThemeParts | null = null,
): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout(LAYOUT);
  pptx.layout = LAYOUT.name;
  // 書体は全体の既定に置く（枠ごとに書くと、あとで足した枠で付け忘れる）
  if (theme.font) {
    pptx.theme = { headFontFace: theme.font, bodyFontFace: theme.font };
  }
  // 共通の体裁（TASKS 5-3）。**ページ番号とフッタは全部の枚に要る** —
  // 手で足すと抜けが出る。pptxgenjs はテンプレートの .pptx を読めないので、
  // マスタはここで組む（ADR-0039 の道具立ての制約）
  pptx.defineSlideMaster({
    title: MASTER,
    objects: [
      {
        line: {
          x: MARGIN,
          y: LAYOUT.height - 0.55,
          w: LAYOUT.width - MARGIN * 2,
          h: 0,
          line: { color: "bg2", width: 0.75 },
        },
      },
      ...(deck.title
        ? [
            {
              text: {
                text: deck.title,
                options: {
                  x: MARGIN,
                  y: LAYOUT.height - 0.5,
                  w: LAYOUT.width / 2,
                  h: 0.3,
                  fontSize: 10,
                  color: "tx2",
                },
              },
            },
          ]
        : []),
    ],
    slideNumber: {
      x: LAYOUT.width - MARGIN - 0.6,
      y: LAYOUT.height - 0.5,
      w: 0.6,
      h: 0.3,
      align: "right",
      fontSize: 10,
      color: "tx2",
    },
  });

  if (deck.title || deck.subtitle) {
    const cover = pptx.addSlide();
    cover.addText(deck.title || "無題", {
      x: MARGIN,
      y: 2.6,
      w: LAYOUT.width - MARGIN * 2,
      h: 1.2,
      fontSize: 40,
      bold: true,
    });
    if (deck.subtitle) {
      cover.addText(deck.subtitle, {
        x: MARGIN,
        y: 3.9,
        w: LAYOUT.width - MARGIN * 2,
        h: 0.8,
        fontSize: 20,
        color: "tx2", // テーマの副色（テンプレートに追従する）
      });
    }
  }

  for (const slide of deck.slides) {
    // 扉は題だけを大きく真ん中に（TASKS 5-3）
    if (slide.kind === "section") {
      const divider = pptx.addSlide({ masterName: MASTER });
      divider.addText(slide.title, {
        x: MARGIN,
        y: LAYOUT.height / 2 - 0.7,
        w: LAYOUT.width - MARGIN * 2,
        h: 1.4,
        fontSize: 36,
        bold: true,
        align: "center",
        valign: "middle",
      });
      if (slide.notes) divider.addNotes(slide.notes);
      continue;
    }
    const page = pptx.addSlide({ masterName: MASTER });
    page.addText(slide.title, {
      x: MARGIN,
      y: 0.6,
      w: LAYOUT.width - MARGIN * 2,
      h: 0.9,
      fontSize: TITLE_POINTS,
      bold: true,
      color: theme.accent,
    });
    // 画像があるスライドは本文を左半分へ寄せる（画像と重ならないように）
    const images = await embedImages(slide.images, resolveImage);
    const bodyWidth =
      (images.length > 0
        ? LAYOUT.width * BODY_RATIO_WITH_IMAGE
        : LAYOUT.width) -
      MARGIN * 2;
    // 小見出しが 2 つ以上あれば横並びの箱にする（TASKS 5-4）
    const cards = images.length === 0 ? cardsOf(slide.blocks) : null;
    if (cards) placeCards(page, cards, theme);
    else placeBlocks(page, slide.blocks, bodyWidth, theme);
    placeImages(page, images, bodyWidth);
    if (slide.notes) page.addNotes(slide.notes);
  }
  const built = (await pptx.write({ outputType: "base64" })) as string;
  return borrowed ? await paintWith(built, borrowed) : built;
}

/// 出来上がった `.pptx` の `theme1.xml` を、借りた配色と書体で塗り替える。
///
/// **後段で入れ替える。** pptxgenjs には配色を入れる口が無い
/// （`pptx.theme` は書体だけ。ADR-0045 の実測）。
/// 失敗したら**そのまま返す** — テンプレートが読めないだけで書き出せなく
/// なるほうが困る。
async function paintWith(base64: string, parts: ThemeParts): Promise<string> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const file = zip.file(THEME_PATH);
    if (!file) return base64;
    zip.file(THEME_PATH, applyThemeParts(await file.async("string"), parts));
    return await zip.generateAsync({ type: "base64" });
  } catch {
    return base64;
  }
}

/// テンプレート（`.pptx` の中身）から借りるところを読む。読めなければ null。
export async function readTemplateTheme(
  bytes: Uint8Array,
): Promise<ThemeParts | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const file = zip.file(THEME_PATH);
    if (!file) return null;
    return themeParts(await file.async("string"));
  } catch {
    return null; // zip ですらない・壊れている
  }
}

const THEME_PATH = "ppt/theme/theme1.xml";

/// 読めた画像だけを返す（読めないものは飛ばす。書き出しは止めない）。
async function embedImages(
  urls: string[],
  resolveImage: ImageResolver,
): Promise<string[]> {
  const found: string[] = [];
  for (const url of urls) {
    const data = await resolveImage(url);
    if (data) found.push(data);
  }
  return found;
}

type Page = Awaited<ReturnType<typeof pageType>>;
declare function pageType(): Promise<
  ReturnType<InstanceType<typeof import("pptxgenjs").default>["addSlide"]>
>;

/// 装飾つきの 1 かたまりを pptxgenjs の形に直す（TASKS 5-1）。
///
/// **書いた装飾をそのまま渡す。** 素の文字にすると、書いた人が PowerPoint
/// 側で付け直すことになる。等幅はインラインコードの印。
function textRun(run: Run, base: object, theme: SlideTheme) {
  return {
    text: run.text,
    options: {
      ...base,
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.strike ? { strike: true } : {}),
      ...(run.code ? { fontFace: theme.mono } : {}),
      ...(run.link ? { hyperlink: { url: run.link } } : {}),
    },
  };
}

/// 横並びの箱（TASKS 5-4）。**箱は同じ幅で割る** — 中身の量で幅を変えると、
/// 資料ごとに並びが揺れて落ち着かない。
function placeCards(page: Page, cards: Card[], theme: SlideTheme): void {
  const gap = 0.3;
  const width =
    (LAYOUT.width - MARGIN * 2 - gap * (cards.length - 1)) / cards.length;
  const height = LAYOUT.height - BODY_TOP - MARGIN - 0.4;
  cards.forEach((card, index) => {
    const left = MARGIN + (width + gap) * index;
    page.addShape("roundRect", {
      x: left,
      y: BODY_TOP,
      w: width,
      h: height,
      fill: { color: "bg2" },
      rectRadius: 0.08,
    });
    page.addText(
      card.heading.map((run, at) =>
        textRun(
          run,
          {
            fontSize: HEADING_POINTS,
            bold: true,
            color: theme.accent,
            ...(at === card.heading.length - 1 ? { breakLine: true } : {}),
          },
          theme,
        ),
      ),
      {
        x: left + 0.2,
        y: BODY_TOP + 0.18,
        w: width - 0.4,
        h: 0.5,
        valign: "top",
      },
    );
    const body = flowRuns(card.blocks, theme);
    if (body.length > 0) {
      page.addText(body, {
        x: left + 0.2,
        y: BODY_TOP + 0.75,
        w: width - 0.4,
        h: height - 0.95,
        valign: "top",
      });
    }
  });
}

/// 文章・箇条書き・小見出しを 1 つの枠に流す形に直す。
function flowRuns(blocks: readonly SlideBlock[], theme: SlideTheme) {
  return blocks.flatMap((block) => {
    if (block.kind === "code" || block.kind === "table") return [];
    const heading = block.kind === "heading";
    return block.runs.map((run, index) =>
      textRun(
        run,
        {
          fontSize: heading ? HEADING_POINTS : BODY_POINTS,
          ...(heading ? { bold: true, color: theme.accent } : {}),
          ...(index === 0 && block.kind === "bullet"
            ? { bullet: true, indentLevel: Math.min(block.level, MAX_LEVEL) }
            : {}),
          ...(index === block.runs.length - 1 ? { breakLine: true } : {}),
        },
        theme,
      ),
    );
  });
}

function placeBlocks(
  page: Page,
  blocks: SlideBlock[],
  width: number,
  theme: SlideTheme,
): void {
  // 文章・箇条書き・小見出しは 1 つの枠にまとめる（段落として流す）。
  // コードと表は入らないので別の図形にする
  const flow = blocks.filter(
    (block) => block.kind !== "code" && block.kind !== "table",
  );
  let top = BODY_TOP;
  if (flow.length > 0) {
    page.addText(flowRuns(flow, theme), {
      x: MARGIN,
      y: top,
      w: width,
      h: 4.4,
      valign: "top",
    });
    top += 4.6;
  }
  for (const block of blocks) {
    if (block.kind === "code") {
      page.addText(block.text, {
        x: MARGIN,
        y: top,
        w: width,
        h: 1.6,
        fontSize: CODE_POINTS,
        fontFace: theme.mono,
        fill: { color: "bg2" },
        color: "tx1",
        valign: "top",
        // 字が縁にくっつくと窮屈に見える（画面の帯と同じ考え方）
        margin: 8,
      });
      top += 1.8;
    } else if (block.kind === "table") {
      const cells = block.rows.map((row) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim()),
      );
      if (cells.length === 0) continue;
      // **見出しの行を塗る**（TASKS 5-2）。1 行目が見出しなのは
      // Markdown の表の決まりで、区切り行は slides.ts が落としている
      const rows = cells.map((row, index) =>
        row.map((cell) => ({
          text: cell,
          options:
            index === 0
              ? { bold: true, color: "bg1", fill: { color: theme.accent } }
              : index % 2 === 0
                ? { fill: { color: "bg2" } } // 縞にして行を追いやすく
                : {},
        })),
      );
      page.addTable(rows, {
        x: MARGIN,
        y: top,
        w: width,
        fontSize: TABLE_POINTS,
        border: { pt: 0.5, color: "bg2" },
        autoPage: false,
      });
      top += 0.4 * rows.length + 0.3;
    }
  }
}

function placeImages(page: Page, images: string[], bodyWidth: number): void {
  if (images.length === 0) return;
  const left = MARGIN + bodyWidth + MARGIN * 0.5;
  const width = LAYOUT.width - left - MARGIN;
  const height = (LAYOUT.height - BODY_TOP - MARGIN) / images.length;
  images.forEach((data, index) => {
    page.addImage({
      data,
      x: left,
      y: BODY_TOP + height * index,
      w: width,
      h: height - 0.2,
      sizing: { type: "contain", w: width, h: height - 0.2 },
    });
  });
}
