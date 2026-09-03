// HTML 書き出し（ADR-0007 の CM6 版）の検証。

import { describe, expect, test } from "vitest";
import { renderHtml } from "./export-html";

describe("renderHtml", () => {
  test("完結した HTML 文書になり、題名はエスケープされる", () => {
    const html = renderHtml("# 見出し\n", "<危ない>題名");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>&lt;危ない&gt;題名</title>");
    expect(html).toContain("<h1>見出し</h1>");
  });

  test("表・取り消し線・脚注・タスクが本物の HTML になる", () => {
    const md = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "~~打ち消し~~と脚注[^1]",
      "",
      "- [x] 済み",
      "",
      "[^1]: 注の本文",
    ].join("\n");
    const html = renderHtml(md, "t");
    expect(html).toContain("<table>");
    expect(html).toContain("<s>打ち消し</s>");
    expect(html).toContain("footnote");
    expect(html).toMatch(/<input[^>]*checked[^>]*>/);
  });

  test("ハイライト :: は mark になる（独自記法）", () => {
    const html = renderHtml("これは::目立つ::です\n", "t");
    expect(html).toContain("<mark>目立つ</mark>");
  });

  test("識別子の :: はハイライトにしない（書き出しの実機回帰）", () => {
    // エディタ側と同じ ASCII 単語ガード。std::vector::size の vector が
    // <mark> になっていた（2026-09-04 の書き出し確認で発覚）
    const html = renderHtml("std::vector::size は識別子\n", "t");
    expect(html).not.toContain("<mark>");
    expect(html).toContain("std::vector::size");
  });

  test("コードフェンスは言語クラス付きで、生の HTML は無効", () => {
    const html = renderHtml(
      "```js\nconst a = 1;\n```\n\n<script>alert(1)</script>\n",
      "t",
    );
    expect(html).toContain('<code class="language-js">');
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("画像はそのまま img になる（src の差し替えは呼び出し側）", () => {
    const html = renderHtml("![図](attachments/a.png)\n", "t");
    expect(html).toContain('<img src="attachments/a.png" alt="図"');
  });
});
