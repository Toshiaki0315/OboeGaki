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

import type { Deck, Run, SlideBlock } from "./slides";

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
/// コードとインラインコードの書体。**画面と同じ系統**にする
const MONO_FONT = "Menlo";
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
): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout(LAYOUT);
  pptx.layout = LAYOUT.name;
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
          line: { color: "D9D9D9", width: 0.75 },
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
                  color: "7F7F7F",
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
      color: "7F7F7F",
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
        color: "595959",
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
    });
    // 画像があるスライドは本文を左半分へ寄せる（画像と重ならないように）
    const images = await embedImages(slide.images, resolveImage);
    const bodyWidth =
      (images.length > 0
        ? LAYOUT.width * BODY_RATIO_WITH_IMAGE
        : LAYOUT.width) -
      MARGIN * 2;
    placeBlocks(page, slide.blocks, bodyWidth);
    placeImages(page, images, bodyWidth);
    if (slide.notes) page.addNotes(slide.notes);
  }
  return (await pptx.write({ outputType: "base64" })) as string;
}

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
function textRun(run: Run, base: object) {
  return {
    text: run.text,
    options: {
      ...base,
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.strike ? { strike: true } : {}),
      ...(run.code ? { fontFace: MONO_FONT } : {}),
      ...(run.link ? { hyperlink: { url: run.link } } : {}),
    },
  };
}

function placeBlocks(page: Page, blocks: SlideBlock[], width: number): void {
  // 文章・箇条書き・小見出しは 1 つの枠にまとめる（段落として流す）。
  // コードと表は入らないので別の図形にする
  const flow = blocks.filter(
    (block) => block.kind !== "code" && block.kind !== "table",
  );
  let top = BODY_TOP;
  if (flow.length > 0) {
    page.addText(
      flow.flatMap((block) => {
        const heading = block.kind === "heading";
        return block.runs.map((run, index) =>
          textRun(run, {
            fontSize: heading ? HEADING_POINTS : BODY_POINTS,
            ...(heading ? { bold: true } : {}),
            // 箇条書きの印と段は**行の頭にだけ**付ける（走りごとに
            // 付けると、装飾の切れ目で点が増える）
            ...(index === 0 && block.kind === "bullet"
              ? {
                  bullet: true,
                  indentLevel: Math.min(block.level, MAX_LEVEL),
                }
              : {}),
            // 改行は行の終わりにだけ
            ...(index === block.runs.length - 1 ? { breakLine: true } : {}),
          }),
        );
      }),
      { x: MARGIN, y: top, w: width, h: 4.4, valign: "top" },
    );
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
        fontFace: MONO_FONT,
        fill: { color: "F5F5F7" },
        color: "1F1F1F",
        valign: "top",
        // 字が縁にくっつくと窮屈に見える（画面の帯と同じ考え方）
        margin: 8,
        line: { color: "E0E0E0", width: 0.75 },
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
              ? { bold: true, color: "FFFFFF", fill: { color: "44546A" } }
              : index % 2 === 0
                ? { fill: { color: "F2F2F2" } } // 縞にして行を追いやすく
                : {},
        })),
      );
      page.addTable(rows, {
        x: MARGIN,
        y: top,
        w: width,
        fontSize: TABLE_POINTS,
        border: { pt: 0.5, color: "BFBFBF" },
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
