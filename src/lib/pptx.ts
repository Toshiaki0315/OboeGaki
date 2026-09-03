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

import type { Deck, SlideBlock } from "./slides";

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
    const page = pptx.addSlide();
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

function placeBlocks(page: Page, blocks: SlideBlock[], width: number): void {
  // 文章・箇条書き・小見出しは 1 つの枠にまとめる（段落として流す）。
  // コードと表は入らないので別の図形にする
  const flow = blocks.filter(
    (block) => block.kind !== "code" && block.kind !== "table",
  );
  let top = BODY_TOP;
  if (flow.length > 0) {
    page.addText(
      flow.map((block) => ({
        text: block.kind === "bullet" ? block.text : block.text,
        options: {
          fontSize: block.kind === "heading" ? HEADING_POINTS : BODY_POINTS,
          bold: block.kind === "heading",
          bullet: block.kind === "bullet" ? true : false,
          indentLevel:
            block.kind === "bullet" ? Math.min(block.level, MAX_LEVEL) : 0,
          breakLine: true,
        },
      })),
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
        fontFace: "Menlo",
        fill: { color: "F2F2F2" },
        valign: "top",
      });
      top += 1.8;
    } else if (block.kind === "table") {
      const rows = block.rows.map((row) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => ({ text: cell.trim() })),
      );
      if (rows.length === 0) continue;
      page.addTable(rows, {
        x: MARGIN,
        y: top,
        w: width,
        fontSize: TABLE_POINTS,
        border: { pt: 0.5, color: "999999" },
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
