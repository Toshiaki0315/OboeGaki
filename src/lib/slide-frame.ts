// 枚の中の置き場所（TASKS 8-6 の土台）。
//
// **書き出しとプレビューで同じ計算を使う**（PV-01 / VA-04）。別々に組むと
// 数値がずれ、「プレビューでは収まっていたのに .pptx では溢れる」が起きて
// 原因も追えなくなる。ここが唯一の置き場所の決め手。

import type { SlideBlock } from "./slides";
import type { SlideMetrics } from "./slide-grid";

/// 置き場所（インチ）。**中身は持たない** — 何を描くかは呼ぶ側が決める。
export type Box = { x: number; y: number; w: number; h: number };

export type Frame =
  /// 文章・箇条書き・小見出しをまとめて流す枠。
  | ({ kind: "flow"; blocks: SlideBlock[] } & Box)
  /// コードの帯。`label` は言語名（出さないときは null）。
  | ({ kind: "code"; block: SlideBlock; label: string | null } & Box)
  /// 表。
  | ({ kind: "table"; block: SlideBlock } & Box);

/// 本文と画像の割り方（GR-04）。
export type BodyLayout = {
  bodyX: number;
  bodyY: number;
  bodyW: number;
  bodyH: number;
  images: Box[];
};

/// 画像があるときの本文の幅（横の用紙。全体に対する割合）。
const BODY_RATIO_WITH_IMAGE = 0.52;
/// 縦の用紙で画像に渡す高さ（本文の高さに対する割合）。
const IMAGE_BAND = 0.42;
/// 画像どうしの隙間。
const IMAGE_GAP = 0.2;

/// 本文と画像をどう割るか。
///
/// **縦の用紙では画像を上、本文を下に積む**（GR-04）。横に並べると本文が
/// 細長い柱になって、字が縦 1 列で落ちてくる。
export function bodyLayout(
  sheet: SlideMetrics,
  imageCount: number,
): BodyLayout {
  const full = {
    bodyX: sheet.margin,
    bodyY: sheet.bodyTop,
    bodyW: sheet.contentW,
    bodyH: sheet.bodyH,
    images: [] as Box[],
  };
  if (imageCount <= 0) return full;

  if (sheet.height > sheet.width) {
    // 縦: 画像の帯を上に、本文を下に
    const bandH = sheet.bodyH * IMAGE_BAND;
    const each = bandH / imageCount;
    return {
      ...full,
      bodyY: sheet.bodyTop + bandH,
      bodyH: sheet.bodyH - bandH,
      images: Array.from({ length: imageCount }, (_, index) => ({
        x: sheet.margin,
        y: sheet.bodyTop + each * index,
        w: sheet.contentW,
        h: each - IMAGE_GAP,
      })),
    };
  }
  // 横: 本文を左、画像を右の柱に
  const bodyW = sheet.width * BODY_RATIO_WITH_IMAGE - sheet.margin * 2;
  const left = sheet.margin + bodyW + sheet.margin * 0.5;
  const width = sheet.width - left - sheet.margin;
  const each = sheet.bodyH / imageCount;
  return {
    ...full,
    bodyW,
    images: Array.from({ length: imageCount }, (_, index) => ({
      x: left,
      y: sheet.bodyTop + each * index,
      w: width,
      h: each - IMAGE_GAP,
    })),
  };
}

/// 本文の枠を上から順に置く。`pptx.ts` もプレビューもこれを描く。
export function bodyFrames(
  blocks: readonly SlideBlock[],
  layout: BodyLayout,
  labelCode: boolean,
): Frame[] {
  const frames: Frame[] = [];
  const flow = blocks.filter(
    (block) => block.kind !== "code" && block.kind !== "table",
  );
  let top = layout.bodyY;
  if (flow.length > 0) {
    frames.push({
      kind: "flow",
      blocks: flow,
      x: layout.bodyX,
      y: top,
      w: layout.bodyW,
      h: layout.bodyH * 0.78,
    });
    top += layout.bodyH * 0.82;
  }
  for (const block of blocks) {
    if (block.kind === "code") {
      const label = labelCode && block.language ? block.language : null;
      if (label) top += LABEL_H;
      frames.push({
        kind: "code",
        block,
        label,
        x: layout.bodyX,
        y: top,
        w: layout.bodyW,
        h: layout.bodyH * 0.28,
      });
      top += layout.bodyH * 0.32;
    } else if (block.kind === "table") {
      frames.push({
        kind: "table",
        block,
        x: layout.bodyX,
        y: top,
        w: layout.bodyW,
        h: layout.bodyH * 0.28,
      });
      top += layout.bodyH * 0.32;
    }
  }
  return frames;
}

/// 言語名の帯の高さ（`code` の枠は**そのぶん下がる**）。
export const LABEL_H = 0.24;
