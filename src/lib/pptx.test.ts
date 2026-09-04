// PowerPoint 書き出し（TASKS 4-5 / 5-1〜5-3）。
//
// **出来上がった .pptx を開いて確かめる。** pptxgenjs に渡した値が
// そのまま形式に載るとは限らないので、zip を解いて XML を見る。

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx } from "./pptx";
import { splitDeck } from "./slides";

async function open(markdown: string) {
  const base64 = await buildPptx(splitDeck(markdown), async () => null);
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
    expect(xml).toContain("44546A"); // 見出しの地
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
