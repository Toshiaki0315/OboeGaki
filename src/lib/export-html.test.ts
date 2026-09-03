// HTML 書き出し（ADR-0007 の CM6 版）の検証。

import { describe, expect, test } from "vitest";
import { codeKey, collectCodeBlocks, renderHtml } from "./export-html";

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

  test("数式は MathML で出る（外部リソースを参照しない / ADR-0036）", () => {
    const html = renderHtml("式は $E = mc^2$ です。\n", "数式");
    expect(html).toContain("<math");
    // 画面と同じ文字列を使うので、フォントも JS も埋めない
    expect(html).not.toContain("<script");
    expect(html).not.toContain("@font-face");
  });

  test("`$$` ブロックはディスプレイ数式になる", () => {
    const html = renderHtml("$$\n\\frac{a}{b}\n$$\n", "数式");
    expect(html).toContain('display="block"');
  });

  test("値段は数式にしない", () => {
    const html = renderHtml("価格は $100 と $200 です。\n", "値段");
    expect(html).not.toContain("<math");
    expect(html).toContain("$100");
  });

  test("組めない式は書いたまま出す", () => {
    const html = renderHtml("壊れた $\\frac{a$ です。\n", "壊れ");
    expect(html).not.toContain("<math");
    expect(html).toContain("\\frac{a");
  });

  test("Mermaid は描いた SVG をそのまま埋める（ADR-0021）", () => {
    const md = "```mermaid\ngraph TD;\n```\n";
    const svg = "<svg><g>図</g></svg>";
    const html = renderHtml(md, "図", new Map([["graph TD;", svg]]));
    expect(html).toContain(svg);
    // 外部リソースを参照しない（JS を読み込まない）
    expect(html).not.toContain("<script");
  });

  test("描けなかった図はコードのまま出す", () => {
    const md = "```mermaid\ngraph TD;\n```\n";
    const html = renderHtml(md, "図", new Map());
    expect(html).toContain("<code");
    expect(html).toContain("graph TD;");
  });

  test("コードは色分けを埋め、言語のクラスは言語だけにする（ADR-0008）", () => {
    const md = "```js:index.js\nlet a = 1;\n```\n";
    const colored = '<span class="tok-keyword">let</span> a = 1;';
    const html = renderHtml(
      md,
      "コード",
      undefined,
      new Map([[codeKey("js:index.js", "let a = 1;\n"), colored]]),
    );
    expect(html).toContain(colored);
    // `language-js:index.js` のままだと受け取った側が言語を見つけられない
    expect(html).toContain('class="language-js"');
    expect(html).not.toContain("language-js:index.js");
    // ファイル名は画面にも書き出しにも出す
    expect(html).toContain('<div class="code-name">index.js</div>');
  });

  test("色分けが無ければ素のコードで出す", () => {
    const html = renderHtml("```unknownlang\nfoo bar\n```\n", "コード");
    expect(html).toContain("foo bar");
    expect(html).toContain('class="language-unknownlang"');
    // 色は付かない（スタイル表に .tok-* があるだけで、本文には出ない）
    expect(html).not.toContain('<span class="tok-');
  });

  test("コードの中の HTML はエスケープされる", () => {
    const html = renderHtml("```\n<script>alert(1)</script>\n```\n", "危険");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("collectCodeBlocks", () => {
  test("言語の付いたフェンスを集める", () => {
    const md = "```js\nlet a = 1;\n```\n\n```\n言語なし\n```\n";
    expect(collectCodeBlocks(md)).toEqual([
      { info: "js", code: "let a = 1;\n" },
    ]);
  });

  test(":::note の囲みが本物の HTML になる（B-3）", () => {
    const md = ":::note warn\n注意です。**強調**も効きます。\n:::\n";
    const html = renderHtml(md, "囲み");
    expect(html).toContain('<div class="note note-warn">');
    // 中身はふつうの Markdown として組む
    expect(html).toContain("<strong>強調</strong>");
  });

  test("種類を省いたら info、知らない綴りは別扱い", () => {
    expect(renderHtml(":::note\n本文\n:::\n", "x")).toContain("note-info");
    // **info に寄せない**（間違いに気づけなくなる）
    expect(renderHtml(":::note warm\n本文\n:::\n", "x")).toContain(
      "note-unknown",
    );
  });

  test("`:::note warn extra` は囲みにしない（2 語まで）", () => {
    expect(renderHtml(":::note warn extra\n本文\n:::\n", "x")).not.toContain(
      '<div class="note',
    );
  });
});
