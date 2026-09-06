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

/// 本文の枠を上から順に置く。`pptx.ts` もプレビューもこれを描く。
export function bodyFrames(
  blocks: readonly SlideBlock[],
  widthIn: number,
  sheet: SlideMetrics,
  labelCode: boolean,
): Frame[] {
  const frames: Frame[] = [];
  const flow = blocks.filter(
    (block) => block.kind !== "code" && block.kind !== "table",
  );
  let top = sheet.bodyTop;
  if (flow.length > 0) {
    frames.push({
      kind: "flow",
      blocks: flow,
      x: sheet.margin,
      y: top,
      w: widthIn,
      h: sheet.bodyH * 0.78,
    });
    top += sheet.bodyH * 0.82;
  }
  for (const block of blocks) {
    if (block.kind === "code") {
      const label = labelCode && block.language ? block.language : null;
      if (label) top += LABEL_H;
      frames.push({
        kind: "code",
        block,
        label,
        x: sheet.margin,
        y: top,
        w: widthIn,
        h: sheet.bodyH * 0.28,
      });
      top += sheet.bodyH * 0.32;
    } else if (block.kind === "table") {
      frames.push({
        kind: "table",
        block,
        x: sheet.margin,
        y: top,
        w: widthIn,
        h: sheet.bodyH * 0.28,
      });
      top += sheet.bodyH * 0.32;
    }
  }
  return frames;
}

/// 言語名の帯の高さ（`code` の枠は**そのぶん下がる**）。
export const LABEL_H = 0.24;
