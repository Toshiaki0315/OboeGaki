// PowerPoint 書き出し（TASKS 4-5 / 5-1〜5-3）。
//
// **出来上がった .pptx を開いて確かめる。** pptxgenjs に渡した値が
// そのまま形式に載るとは限らないので、zip を解いて XML を見る。

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx, readTemplateTheme } from "./pptx";
import { splitDeck } from "./slides";
import { DEFAULT_SLIDE_THEME, readSlideTheme } from "./slide-theme";

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
