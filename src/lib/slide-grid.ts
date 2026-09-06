// 用紙とグリッド（TASKS 8-3。仕様 6 章）。
//
// **16:9 前提の数値をあちこちに書かない**（GR-01）。用紙の大きさが変われば
// 余白も列も字の大きさも変わるので、**`deriveGrid()` を唯一の入口**にする。
// `pptx.ts` は「グリッドから貰う」だけにして、自分で 0.7 や 1.8 を持たない。

import { PAGE_SIZES, type PptxSettings } from "./pptx-settings";

/// 導出の基準にする用紙（16:9）。**ここだけが素の数字を持つ。**
const BASE_WIDTH_IN = 13.333;
const BASE_HEIGHT_IN = 7.5;

export type PageSize = { widthIn: number; heightIn: number };

export type Grid = {
  marginX: number;
  marginTop: number;
  marginBottom: number;
  gutter: number;
  columns: number;
  colW: number;
  contentW: number;
};

/// 余白の広さ（CFG-44）。
export const MARGIN_SCALES = { compact: 0.8, normal: 1, wide: 1.25 } as const;
/// 字の大きさ（CFG-34 / CFG-38）。
export const FONT_SCALES = { small: 0.9, normal: 1, large: 1.15 } as const;

/// 設定から用紙の実寸（インチ）を出す。
export function pageOf(settings: PptxSettings): PageSize {
  const { preset, customWidthIn, customHeightIn } = settings.page;
  if (preset === "custom") {
    return { widthIn: customWidthIn, heightIn: customHeightIn };
  }
  return PAGE_SIZES[preset];
}

/// キャンバスからグリッドを導く（GR-01。仕様 6 章の式そのまま）。
export function deriveGrid(
  widthIn: number,
  heightIn: number,
  marginScale: number,
): Grid {
  const s = widthIn / BASE_WIDTH_IN;
  const marginX = Math.max(0.5, 0.7 * s * marginScale);
  const margin = Math.max(
    0.4,
    0.55 * (heightIn / BASE_HEIGHT_IN) * marginScale,
  );
  const gutter = 0.2 * s;
  // 細すぎる列はレイアウトの役に立たない（GR-03）
  const columns = widthIn >= 9 ? 12 : 6;
  const contentW = widthIn - marginX * 2;
  const colW = (contentW - gutter * (columns - 1)) / columns;
  return {
    marginX,
    marginTop: margin,
    marginBottom: margin,
    gutter,
    columns,
    colW,
    contentW,
  };
}

/// 用紙の高さから字の大きさの倍率（GR-02）。**行きすぎは止める** —
/// 縦長の紙で字だけ巨大になっても読みやすくならない。
export function typeScale(heightIn: number): number {
  return Math.min(1.4, Math.max(0.7, heightIn / BASE_HEIGHT_IN));
}

/// 1 枚を組むのに要る寸法一式。**`pptx.ts` はここから貰うだけ**にして、
/// 自分で 0.7 や 1.8 を持たない（GR-01）。
export type SlideMetrics = {
  /// 用紙（インチ）。
  width: number;
  height: number;
  /// 左右の余白。
  margin: number;
  /// 上下の余白。
  marginTop: number;
  /// 本文が始まる高さ（題の帯のぶんだけ下がる）。
  bodyTop: number;
  /// 本文に使える幅。
  contentW: number;
  /// 本文に使える高さ（題の帯とフッタを除いたぶん）。
  bodyH: number;
  /// 題の帯（枚の見出し）の上端と高さ。
  titleY: number;
  titleH: number;
  /// 表紙の題と副題の上端。
  coverTitleY: number;
  coverSubtitleY: number;
  /// フッタの線と字の上端。
  footerLineY: number;
  footerY: number;
  gutter: number;
  columns: number;
  colW: number;
  /// 字の大きさ（pt）。用紙の高さと設定の倍率を掛けたあと、整数に丸める。
  points: {
    title: number;
    body: number;
    heading: number;
    code: number;
    table: number;
  };
};

/// 16:9 で決めた基準（従来の見た目）。**倍率を掛ける前の値。**
const BASE_POINTS = {
  title: 30,
  body: 17,
  heading: 19,
  code: 13,
  table: 13,
} as const;
/// 題の帯の高さ（基準の用紙で 1.25in）。本文はこのぶん下がる。
const TITLE_BAND_IN = 1.25;

/// 設定から寸法一式を出す（唯一の入口）。
export function slideMetrics(settings: PptxSettings): SlideMetrics {
  const page = pageOf(settings);
  const grid = deriveGrid(
    page.widthIn,
    page.heightIn,
    MARGIN_SCALES[settings.layout.marginScale],
  );
  // 用紙の高さぶん（GR-02）と、設定の大小（CFG-38）を掛けてから丸める
  const scale = typeScale(page.heightIn) * FONT_SCALES[settings.font.scale];
  const points = Object.fromEntries(
    Object.entries(BASE_POINTS).map(([name, value]) => [
      name,
      Math.max(8, Math.round(value * scale)),
    ]),
  ) as SlideMetrics["points"];
  const band = TITLE_BAND_IN * typeScale(page.heightIn);
  const bodyTop = grid.marginTop + band;
  // フッタは下の余白の中に置く（線・字・番号が同じ高さに並ぶ）
  const footerLineY = page.heightIn - grid.marginBottom;
  return {
    width: page.widthIn,
    height: page.heightIn,
    margin: grid.marginX,
    marginTop: grid.marginTop,
    bodyTop,
    bodyH: page.heightIn - bodyTop - grid.marginBottom,
    titleY: grid.marginTop,
    titleH: band * 0.72,
    // **表紙は真ん中より少し上**（下に副題が入る）
    coverTitleY: page.heightIn * 0.35,
    coverSubtitleY: page.heightIn * 0.52,
    footerLineY,
    footerY: footerLineY + 0.05,
    contentW: grid.contentW,
    gutter: grid.gutter,
    columns: grid.columns,
    colW: grid.colW,
    points,
  };
}
