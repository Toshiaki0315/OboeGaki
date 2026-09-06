// 書き出し前チェック（TASKS 8-5 の見張り / CFG-70）。
//
// **溢れているかもしれない枚を知らせるだけ。** 直すのは人の仕事で、
// こちらが勝手に削ったり縮めたりはしない（ADR-0039 の「ざっくり作って
// 手で整える」構え）。
//
// 測り方は近似（`text-width.ts`）なので、**多めに見積もる**。溢れていると
// 言って収まっているほうが、逆より困らない。

import { plainText, type Deck, type SlideBlock } from "./slides";
import type { SlideMetrics } from "./slide-grid";
import { wrapCount } from "./text-width";
import { bodyLayout } from "./slide-frame";

export type Overflow = {
  /// 何枚目か（表紙を 1 枚目として数える）。
  index: number;
  title: string;
  /// 要る高さ（インチ）と、置ける高さ。
  needIn: number;
  roomIn: number;
};

/// 行の高さ（字の大きさの何倍か）。PowerPoint の既定に合わせる。
const LINE = 1.2;
/// 段落と段落のあいだ。
const GAP_IN = 0.12;

/// 1 枚ぶんの高さを見積もる（インチ）。**枚を割るほう（8-5）も同じ物差しを
/// 使う** — 別々に測ると「割ったのに溢れている」が起きる。
export function estimateHeightIn(
  blocks: readonly SlideBlock[],
  widthIn: number,
  metrics: SlideMetrics,
): number {
  let total = 0;
  for (const block of blocks) {
    if (block.kind === "code") {
      const lines = block.text.split("\n").length;
      total += (lines * metrics.points.code * LINE) / 72 + GAP_IN * 2;
      continue;
    }
    if (block.kind === "table") {
      total += (block.rows.length * metrics.points.table * LINE) / 72 + GAP_IN;
      continue;
    }
    const points =
      block.kind === "heading" ? metrics.points.heading : metrics.points.body;
    const lines = wrapCount(plainText(block.runs), widthIn, points);
    total += (lines * points * LINE) / 72 + GAP_IN;
  }
  return total;
}

/// 収まらないかもしれない枚（CFG-70）。**扉と表紙は数えない** —
/// 題だけなので溢れようがない。
export function overflowingSlides(
  deck: Deck,
  metrics: SlideMetrics,
): Overflow[] {
  const found: Overflow[] = [];
  // 表紙があるぶん、番号を 1 つずらす（画面の言い方と合わせる）
  const offset = deck.title || deck.subtitle ? 1 : 0;
  deck.slides.forEach((slide, at) => {
    if (slide.kind !== "content") return;
    // 本文に使える幅と高さは `slide-frame.ts` が決める（画像があるとき・
    // 縦の用紙のときで変わる）
    const layout = bodyLayout(metrics, slide.images.length);
    const needIn = estimateHeightIn(slide.blocks, layout.bodyW, metrics);
    if (needIn > layout.bodyH) {
      found.push({
        index: at + offset + 1,
        title: slide.title,
        needIn,
        roomIn: metrics.bodyH,
      });
    }
  });
  return found;
}
