// @vitest-environment jsdom
// 見本（fixtures/samples/）が**試せる形のまま**であることを見張る
// （要望 2026-09-13 / `make samples` で作り直す）。
//
// 見本は手で触ると崩れる。「この見本で何を試せるはずか」をここに書いておけば、
// 作り直したときにも中身が変わったときにも気付ける。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { csvToMarkdown, parseCsv } from "./csv";
import { renderHtml } from "./export-html";
import { readPptx, slidesToMarkdown } from "./pptx-import";
import { splitDeck } from "./slides";

const SAMPLES = "fixtures/samples";
const IMPORT = `${SAMPLES}/読み込みの見本`;
const markdown = readFileSync(`${SAMPLES}/書き出しの見本.md`, "utf8");

describe("書き出しの見本", () => {
  test("test_書き出しで試したいものが一通り入っている", () => {
    for (const piece of [
      "**太字**",
      "~~打ち消し~~",
      "::マーカー::",
      '<span style="color: #c0392b">',
      "[[おぼえがきの使い方|手引き]]",
      "[^1]",
      "- [ ] ",
      "| 項目 ",
      "```python:sample.py",
      "```mermaid",
      "$$",
      ":::note info",
      ":::details",
      "> 引用です",
      "![図の説明|320]",
    ]) {
      expect(markdown, `${piece} が見本から消えている`).toContain(piece);
    }
  });

  test("test_HTML に組める（数式・図・囲み・脚注まで）", () => {
    const html = renderHtml(markdown, "書き出しの見本");
    expect(html).toContain("<h1"); // 題
    expect(html).toContain("<table"); // 表
    expect(html).toContain("<s>"); // 打ち消し（markdown-it は <s>）
    expect(html).toContain("<mark"); // マーカー
    expect(html).toContain("<math"); // 数式（Temml が MathML に）
    expect(html).toContain("mermaid"); // 図
    expect(html).toContain("<details"); // 畳み
    expect(html).toContain("footnote"); // 脚注
  });

  test("test_PowerPoint の割り方に乗る（見出し 2 ごとに 1 枚）", () => {
    const deck = splitDeck(markdown);
    expect(deck.title).toBe("書き出しの見本");
    expect(deck.slides.length).toBeGreaterThanOrEqual(8);
    // 引用は発表者ノートへ、表とコードはそのまま枚の中へ
    expect(deck.slides.some((slide) => slide.notes.includes("引用です"))).toBe(
      true,
    );
    expect(
      deck.slides.some((slide) =>
        slide.blocks.some((block) => block.kind === "table"),
      ),
    ).toBe(true);
    expect(
      deck.slides.some((slide) =>
        slide.blocks.some((block) => block.kind === "code"),
      ),
    ).toBe(true);
  });
});

describe("読み込みの見本", () => {
  test("test_CSV は落として表になる（引用符・読点・ふぞろいの行）", () => {
    const table = parseCsv(readFileSync(`${IMPORT}/表.csv`, "utf8"));
    expect(table[0]).toEqual(["商品", "数量", "単価", "備考"]);
    // 引用符の中の読点は 1 つのセル
    expect(table[2][0]).toBe("消しゴム, 白");
    // 足りない列はそのまま（埋めるのは表にするとき）
    expect(table[table.length - 1]).toEqual(["クリップ", "100"]);
    const md = csvToMarkdown(table);
    expect(md).toContain("| 商品 | 数量 | 単価 | 備考 |");
    expect(md).toContain("| クリップ | 100 |  |  |");
  });

  test("test_PowerPoint は枚ごとに読める（題・箇条書き・発表者ノート）", async () => {
    const slides = await readPptx(
      new Uint8Array(readFileSync(`${IMPORT}/見本.pptx`)),
    );
    expect(slides.length).toBe(3);
    const text = slidesToMarkdown("見本", slides);
    expect(text).toContain("PowerPoint の見本");
    expect(text).toContain("一つ目の項目");
    expect(text).toContain("発表者ノート");
  });

  test("test_SVG と PNG と JPG は絵として置いてある", () => {
    const svg = readFileSync(`${IMPORT}/図.svg`, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(readFileSync(`${IMPORT}/写真.png`).subarray(1, 4).toString()).toBe(
      "PNG",
    );
    expect(readFileSync(`${IMPORT}/写真.jpg`).subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    );
  });
});
