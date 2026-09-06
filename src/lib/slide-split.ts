// 情報密度で枚を割る（TASKS 8-5 / CFG-41 / 42 / 43 / 46）。
//
// **溢れは許さない**（CFG-46）。「詳しく」を選んでも、収まらないぶんは
// 次の枚へ送る — 字を勝手に縮めたり、書いた文を削ったりはしない
// （ADR-0039 の「ざっくり作って手で整える」構えを崩さない）。
//
// 物差しは見張り（`slide-lint.ts`）と同じものを使う。別々に測ると
// 「割ったのに溢れている」が起きる。

import type { Deck, Slide, SlideBlock } from "./slides";
import { plainText } from "./slides";
import type { SlideMetrics } from "./slide-grid";
import type { PptxSettings } from "./pptx-settings";
import { estimateHeightIn } from "./slide-lint";

/// 画像があるときの本文の幅（`pptx.ts` と同じ割り方）。
const BODY_RATIO_WITH_IMAGE = 0.52;

/// 設定に合わせて枚を割り直す。**扉と表紙は触らない。**
export function splitForDensity(
  deck: Deck,
  settings: PptxSettings,
  metrics: SlideMetrics,
): Deck {
  const slides: Slide[] = [];
  for (const slide of deck.slides) {
    if (slide.kind !== "content") {
      slides.push(slide);
      continue;
    }
    slides.push(...splitOne(slide, settings, metrics));
  }
  return { ...deck, slides };
}

function splitOne(
  slide: Slide,
  settings: PptxSettings,
  metrics: SlideMetrics,
): Slide[] {
  const { density, maxBulletItems, continuationSuffix } = settings.layout;
  // 要点のみ: 段落は発表者ノートへ回す（CFG-45 の言い方どおりの動き）
  let blocks = slide.blocks;
  let notes = slide.notes;
  if (density === "sparse") {
    const moved = blocks.filter((block) => block.kind === "paragraph");
    blocks = blocks.filter((block) => block.kind !== "paragraph");
    const said = moved.map((block) => plainText(block.runs)).join("\n");
    if (said) notes = notes ? `${notes}\n${said}` : said;
  }
  const widthIn =
    slide.images.length > 0
      ? metrics.contentW * BODY_RATIO_WITH_IMAGE
      : metrics.contentW;

  // 1 枚ぶんずつ詰めていく。**必ず 1 つは載せる** — 載せられないものが
  // あっても、そこで止まると枚が無限に増える
  const pages: SlideBlock[][] = [];
  let page: SlideBlock[] = [];
  let bullets = 0;
  const flush = () => {
    if (page.length > 0) pages.push(page);
    page = [];
    bullets = 0;
  };
  for (const block of blocks) {
    const next = [...page, block];
    const tooMany =
      block.kind === "bullet" && bullets + 1 > Math.max(1, maxBulletItems);
    const tooTall =
      page.length > 0 &&
      estimateHeightIn(next, widthIn, metrics) > metrics.bodyH;
    if (tooMany || tooTall) flush();
    page.push(block);
    if (block.kind === "bullet") bullets += 1;
  }
  flush();
  if (pages.length === 0) pages.push([]);

  return pages.map((blocksOfPage, index) => ({
    ...slide,
    // **続きの枚には印を付ける**（CFG-43）。同じ題が並ぶと、資料を配った
    // ときにどれが続きなのか分からない
    title: index === 0 ? slide.title : `${slide.title}${continuationSuffix}`,
    blocks: blocksOfPage,
    // 画像と発表者ノートは最初の枚に置く（続きへ写すと二重に出る）
    images: index === 0 ? slide.images : [],
    notes: index === 0 ? notes : "",
  }));
}
