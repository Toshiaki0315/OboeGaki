// PowerPoint 書き出し（TASKS 4-5 / 5-1〜5-3）。
//
// **出来上がった .pptx を開いて確かめる。** pptxgenjs に渡した値が
// そのまま形式に載るとは限らないので、zip を解いて XML を見る。

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildPptx,
  DEFAULT_PPTX_OPTIONS,
  readTemplateTheme,
  type PptxOptions,
} from "./pptx";
import { splitDeck } from "./slides";
import { DEFAULT_SLIDE_THEME, readSlideTheme } from "./slide-theme";
import { slideMetrics } from "./slide-grid";
import { DEFAULT_PPTX_SETTINGS, type PptxSettings } from "./pptx-settings";

async function open(markdown: string) {
  const base64 = await buildPptx(
    splitDeck(markdown),
    async () => null,
    readSlideTheme(markdown),
  );
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const slide = async (index: number) =>
    (await zip.file(`ppt/slides/slide${index}.xml`)?.async("string")) ?? "";
  const count = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  ).length;
  return { zip, slide, count };
}

describe("環境設定からの体裁（TASKS 8-2）", () => {
  const build = async (markdown: string, options: PptxOptions) => {
    const base64 = await buildPptx(
      splitDeck(markdown),
      async () => null,
      readSlideTheme(markdown),
      null,
      options,
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    // **マスタとレイアウトの両方を見る。** pptxgenjs はマスタに置いた
    // 図形をレイアウト側の XML に書く（実測 2026-09-06）
    const parts: string[] = [];
    for (const name of Object.keys(zip.files)) {
      if (!/^ppt\/slide(Masters|Layouts)\/.*\.xml$/.test(name)) continue;
      parts.push((await zip.file(name)?.async("string")) ?? "");
    }
    return {
      master: parts.join("\n"),
      slide: (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "",
    };
  };

  it("test_CFG_50_ページ番号を切れる", async () => {
    const on = await build("# 題\n\n## A\n\nあ\n", DEFAULT_PPTX_OPTIONS);
    expect(on.master).toContain("slidenum");
    const off = await build("# 題\n\n## A\n\nあ\n", {
      ...DEFAULT_PPTX_OPTIONS,
      footer: { ...DEFAULT_PPTX_OPTIONS.footer, pageNumber: false },
    });
    expect(off.master).not.toContain("slidenum");
  });

  it("test_CFG_51_フッタの字を決められる（空なら題名）", async () => {
    const named = await build("# 題\n\n## A\n\nあ\n", {
      ...DEFAULT_PPTX_OPTIONS,
      footer: { ...DEFAULT_PPTX_OPTIONS.footer, text: "社外秘" },
    });
    expect(named.master).toContain("社外秘");
    expect(named.master).not.toContain(">題<");
    const bare = await build("# 題\n\n## A\n\nあ\n", DEFAULT_PPTX_OPTIONS);
    expect(bare.master).toContain("題");
  });

  it("test_CFG_52_日付を出せる", async () => {
    const dated = await build("# 題\n\n## A\n\nあ\n", {
      ...DEFAULT_PPTX_OPTIONS,
      footer: { ...DEFAULT_PPTX_OPTIONS.footer, showDate: true },
      today: new Date(2026, 8, 6),
    });
    expect(dated.master).toContain("2026-09-06");
  });

  it("test_CFG_73_コードの言語名を出す（既定は出す）", async () => {
    const shown = await build(
      "## A\n\n```js\nlet a = 1;\n```\n",
      DEFAULT_PPTX_OPTIONS,
    );
    expect(shown.slide).toContain("js");
    const hidden = await build("## A\n\n```js\nlet a = 1;\n```\n", {
      ...DEFAULT_PPTX_OPTIONS,
      decoration: {
        ...DEFAULT_PPTX_OPTIONS.decoration,
        codeLanguageLabel: false,
      },
    });
    expect(hidden.slide).not.toContain(">js<");
  });

  it("test_言語を書いていないコードには何も足さない", async () => {
    const plain = await build(
      "## A\n\n```\nlet a = 1;\n```\n",
      DEFAULT_PPTX_OPTIONS,
    );
    expect(plain.slide).toContain("let a = 1;");
  });
});

describe("用紙サイズ（TASKS 8-3 / GR-06）", () => {
  const build = async (settings: PptxSettings) => {
    const base64 = await buildPptx(
      splitDeck("# 題\n\n## A\n\nあ\n"),
      async () => null,
      DEFAULT_SLIDE_THEME,
      null,
      { ...DEFAULT_PPTX_OPTIONS, metrics: slideMetrics(settings) },
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    return (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  };
  const withPage = (page: Partial<PptxSettings["page"]>): PptxSettings => ({
    ...DEFAULT_PPTX_SETTINGS,
    page: { ...DEFAULT_PPTX_SETTINGS.page, ...page },
  });

  /// PowerPoint は EMU（1in = 914400）で持つ
  const emu = (inches: number) => Math.round(inches * 914400);

  it("test_既定は 16 対 9（13.333 × 7.5in）", async () => {
    const xml = await build(DEFAULT_PPTX_SETTINGS);
    expect(xml).toContain(`cx="${emu(13.333)}"`);
    expect(xml).toContain(`cy="${emu(7.5)}"`);
  });

  it("test_4 対 3 を選ぶとその大きさで出る", async () => {
    const xml = await build(withPage({ preset: "4:3" }));
    expect(xml).toContain(`cx="${emu(10)}"`);
    expect(xml).toContain(`cy="${emu(7.5)}"`);
  });

  it("test_縦の用紙は縦で出る", async () => {
    const xml = await build(withPage({ preset: "a4-portrait" }));
    // 8.27 × 11.69in（高さのほうが大きい）
    const width = Number(/sldSz[^>]*cx="(\d+)"/.exec(xml)?.[1] ?? 0);
    const height = Number(/sldSz[^>]*cy="(\d+)"/.exec(xml)?.[1] ?? 0);
    expect(height).toBeGreaterThan(width);
  });

  it("test_カスタムの大きさも通る", async () => {
    const xml = await build(
      withPage({ preset: "custom", customWidthIn: 20, customHeightIn: 10 }),
    );
    expect(xml).toContain(`cx="${emu(20)}"`);
  });
});

describe("縦の用紙では縦に積む（TASKS 8-4 / GR-04）", () => {
  const cardDoc = "## A\n\n### 一\n\nあ\n\n### 二\n\nい\n";
  const build = async (preset: PptxSettings["page"]["preset"]) => {
    const settings = {
      ...DEFAULT_PPTX_SETTINGS,
      page: { ...DEFAULT_PPTX_SETTINGS.page, preset },
    };
    const base64 = await buildPptx(
      splitDeck(cardDoc),
      async () => null,
      DEFAULT_SLIDE_THEME,
      null,
      { ...DEFAULT_PPTX_OPTIONS, metrics: slideMetrics(settings) },
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const xml =
      (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    // 箱（roundRect）の位置を拾う。**形の直前の `<a:off>` が箱の位置**
    // （DrawingML は xfrm → prstGeom の順に書く）
    return [...xml.matchAll(/prst="roundRect"/g)].map((found) => {
      const before = xml.slice(0, found.index);
      const offsets = [
        ...before.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/g),
      ];
      const last = offsets[offsets.length - 1];
      return { x: Number(last[1]), y: Number(last[2]) };
    });
  };

  it("test_横の用紙では横に並ぶ（x が違い y が同じ）", async () => {
    const boxes = await build("16:9");
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[0].x).not.toBe(boxes[1].x);
  });

  it("test_縦の用紙では縦に積む（x が同じで y が違う）", async () => {
    const boxes = await build("a4-portrait");
    expect(boxes[0].x).toBe(boxes[1].x);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  });
});

describe("buildPptx", () => {
  it("test_太字と斜体とコードが形式に載る", async () => {
    const deck = await open("## A\n\n**太字**と*斜体*と`コード`\n");
    const xml = await deck.slide(1);
    expect(xml).toContain('b="1"'); // 太字
    expect(xml).toContain('i="1"'); // 斜体
    expect(xml).toContain("Menlo"); // インラインコード
  });

  it("test_リンクは押せる形で載る", async () => {
    const deck = await open("## A\n\n[覚書](https://example.com/a)\n");
    const xml = await deck.slide(1);
    expect(xml).toContain("hlinkClick");
    const rels =
      (await deck.zip
        .file("ppt/slides/_rels/slide1.xml.rels")
        ?.async("string")) ?? "";
    expect(rels).toContain("https://example.com/a");
  });

  it("test_表の見出しの行を塗る", async () => {
    const deck = await open("## A\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    const xml = await deck.slide(1);
    // **テーマの色で塗る**（ADR-0045 案 A）。生の値だとテンプレートを
    // 当てても表の見出しだけ変わらない
    expect(xml).toContain('schemeClr val="accent1"');
  });

  it("test_2つ目以降の見出し1は扉の1枚になる", async () => {
    // **捨てない**（TASKS 5-3）。表紙 + A + 扉 + B の 4 枚
    const deck = await open("# 題\n\n## A\n\n# 第 2 部\n\n## B\n");
    expect(deck.count).toBe(4);
    expect(await deck.slide(3)).toContain("第 2 部");
  });

  it("test_ページ番号を入れる", async () => {
    const deck = await open("## A\n\n本文\n");
    const master =
      (await deck.zip
        .file("ppt/slideMasters/slideMaster1.xml")
        ?.async("string")) ?? "";
    const layouts = Object.keys(deck.zip.files).filter((name) =>
      name.startsWith("ppt/slideLayouts/"),
    );
    expect(master.length + layouts.length).toBeGreaterThan(0);
    expect(await deck.slide(1)).toContain("slidenum");
  });
});

describe("見た目とカード（TASKS 5-4 / 5-5）", () => {
  it("test_小見出しが2つあれば箱が並ぶ", async () => {
    const deck = await open("## A\n\n### 前\n\nx\n\n### 後\n\ny\n");
    const xml = await deck.slide(1);
    // 角丸の箱が 2 つ（`roundRect` は prstGeom で出る）
    expect(xml.match(/roundRect/g)?.length).toBe(2);
  });

  it("test_箱にできないスライドは今までどおり縦に流す", async () => {
    const deck = await open("## A\n\n### 前\n\nx\n");
    expect(await deck.slide(1)).not.toContain("roundRect");
  });

  it("test_front_matter の色と書体が載る", async () => {
    const deck = await open(
      [
        "---",
        "slide-accent: '#0A84FF'",
        "slide-mono: Courier New",
        "---",
        "",
        "## A",
        "",
        "`コード` と本文",
        "",
        "| a |",
        "| --- |",
        "| 1 |",
      ].join("\n"),
    );
    const xml = await deck.slide(1);
    expect(xml).toContain("0A84FF"); // 題と表の見出し
    expect(xml).toContain("Courier New"); // インラインコードの書体
  });
});

describe("テンプレートの配色と書体（TASKS 5-6 / ADR-0045 案 A）", () => {
  /// テンプレートの代役。中身は本物と同じ形の theme1.xml だけ持つ
  async function fakeTemplate(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
      "ppt/theme/theme1.xml",
      `<a:theme xmlns:a="x"><a:themeElements>` +
        `<a:clrScheme name="社内"><a:dk1><a:srgbClr val="111111"/></a:dk1>` +
        `<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
        `<a:accent1><a:srgbClr val="C8102E"/></a:accent1></a:clrScheme>` +
        `<a:fontScheme name="社内"><a:majorFont><a:latin typeface="Meiryo"/></a:majorFont>` +
        `<a:minorFont><a:latin typeface="Meiryo"/></a:minorFont></a:fontScheme>` +
        `<a:fmtScheme name="社内"/></a:themeElements></a:theme>`,
    );
    return zip.generateAsync({ type: "uint8array" });
  }

  it("test_テンプレートの配色と書体が入る", async () => {
    const parts = await readTemplateTheme(await fakeTemplate());
    expect(parts).not.toBeNull();
    const base64 = await buildPptx(
      splitDeck("## A\n\n本文\n"),
      async () => null,
      DEFAULT_SLIDE_THEME,
      parts,
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const theme = await zip.file("ppt/theme/theme1.xml")!.async("string");
    expect(theme).toContain("C8102E"); // 社内の色
    expect(theme).toContain("Meiryo"); // 社内の書体
    // 図形の塗り方はこちらのまま（借りるのは色と字だけ）
    expect(theme).toContain("fmtScheme");
    expect(theme).not.toContain('name="社内"><a:fillStyleLst');
  });

  it("test_テンプレートでない zip は借りない（書き出しは止めない）", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "これは pptx ではない");
    expect(
      await readTemplateTheme(await zip.generateAsync({ type: "uint8array" })),
    ).toBeNull();
  });

  it("test_壊れたファイルでも落ちない", async () => {
    expect(await readTemplateTheme(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
