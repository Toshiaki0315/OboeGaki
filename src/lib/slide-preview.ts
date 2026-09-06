// プレビュー（TASKS 8-6 / PV-01〜05）。
//
// **設定の良し悪しは数値では分からない。** 用紙や余白や字の大きさを変えた
// ときに、どう見えるかをその場で見せる。
//
// **置き場所は書き出しと同じ計算から出す**（PV-01 / VA-04）。`slide-grid` の
// 寸法と `slide-frame` の枠、`slide-split` の枚割りを、そのまま通す。
//
// **ただし当たると言わない**（PV-05）。字の幅は近似（`text-width.ts`）で、
// 本物の書体で組むのは出力先の PowerPoint。**形と収まり具合の目安**まで。

import { splitDeck, type Slide } from "./slides";
import { splitForDensity } from "./slide-split";
import { slideMetrics } from "./slide-grid";
import { bodyFrames, bodyLayout, LABEL_H, type Frame } from "./slide-frame";
import type { PptxSettings } from "./pptx-settings";

/// 画面に出す枠。本文の枠（`slide-frame`）に、題と表紙と画像を足したもの。
export type PreviewFrame =
  | Frame
  | {
      kind: "title" | "cover" | "subtitle" | "image" | "footer";
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
    };

export type PreviewPage = { title: string; frames: PreviewFrame[] };

export type Preview = {
  widthIn: number;
  heightIn: number;
  pages: PreviewPage[];
};

/// 見せる枚数（PV-03 と同じ 5 枚まで）。**設定画面で重い処理をしない。**
const MAX_PAGES = 5;

/// Markdown と設定から、画面に出す枠を作る。
export function previewOf(markdown: string, settings: PptxSettings): Preview {
  const sheet = slideMetrics(settings);
  const deck = splitForDensity(
    splitDeck(markdown, settings.layout.splitLevel),
    settings,
    sheet,
  );
  const pages: PreviewPage[] = [];
  if (deck.title || deck.subtitle) {
    pages.push({
      title: deck.title,
      frames: [
        {
          kind: "cover",
          text: deck.title || "無題",
          x: sheet.margin,
          y: sheet.coverTitleY,
          w: sheet.width - sheet.margin * 2,
          h: sheet.titleH * 1.4,
        },
        ...(deck.subtitle
          ? [
              {
                kind: "subtitle" as const,
                text: deck.subtitle,
                x: sheet.margin,
                y: sheet.coverSubtitleY,
                w: sheet.width - sheet.margin * 2,
                h: sheet.titleH,
              },
            ]
          : []),
      ],
    });
  }
  for (const slide of deck.slides) {
    if (pages.length >= MAX_PAGES) break;
    pages.push(pageOf(slide, sheet, settings));
  }
  return { widthIn: sheet.width, heightIn: sheet.height, pages };
}

function pageOf(
  slide: Slide,
  sheet: ReturnType<typeof slideMetrics>,
  settings: PptxSettings,
): PreviewPage {
  if (slide.kind === "section") {
    return {
      title: slide.title,
      frames: [
        {
          kind: "cover",
          text: slide.title,
          x: sheet.margin,
          y: sheet.height / 2 - sheet.titleH / 2,
          w: sheet.width - sheet.margin * 2,
          h: sheet.titleH * 1.4,
        },
      ],
    };
  }
  // 本文と画像の割り方は書き出しと同じ（GR-04 の縦積みもここで決まる）
  const layout = bodyLayout(sheet, slide.images.length);
  const frames: PreviewFrame[] = [
    {
      kind: "title",
      text: slide.title,
      x: sheet.margin,
      y: sheet.titleY,
      w: sheet.width - sheet.margin * 2,
      h: sheet.titleH,
    },
    ...bodyFrames(slide.blocks, layout, settings.decoration.codeLanguageLabel),
  ];
  slide.images.forEach((image, index) => {
    const box = layout.images[index];
    if (!box) return;
    frames.push({ kind: "image", text: image.alt, ...box });
  });
  if (settings.footer.pageNumber || settings.footer.text) {
    frames.push({
      kind: "footer",
      text: settings.footer.text,
      x: sheet.margin,
      y: sheet.footerY,
      w: sheet.width - sheet.margin * 2,
      h: LABEL_H,
    });
  }
  return { title: slide.title, frames };
}

/// 設定画面に出す見本（PV-02）。**ユーザーの実文書は使わない** —
/// 設定を触るたびに重い処理をしないため。
export const SAMPLE_DECKS: { name: string; markdown: string }[] = [
  {
    name: "表紙",
    markdown: "# 四半期のふりかえり\n\n2026-09-06 / 覚書チーム\n",
  },
  {
    name: "箇条書き",
    markdown: [
      "## 今期に決めたこと",
      "",
      "- 書き出しの見た目を整える",
      "- 用紙の大きさを選べるようにする",
      "- 収まらないときは次の枚へ送る",
      "- 発表者ノートに原文を残す",
      "",
    ].join("\n"),
  },
  {
    name: "比較",
    markdown: [
      "## 二つの案",
      "",
      "### 案 A",
      "",
      "今の作りに載せる。早い。",
      "",
      "### 案 B",
      "",
      "作り直す。時間がかかる。",
      "",
    ].join("\n"),
  },
  {
    name: "画像と文章",
    markdown: [
      "## 使われ方",
      "",
      "書いたものを、そのまま資料にできます。",
      "",
      "![画面の写真](sample.png)",
      "",
    ].join("\n"),
  },
];
