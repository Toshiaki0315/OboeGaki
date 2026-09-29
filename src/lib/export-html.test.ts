// HTML 書き出し（ADR-0007 の CM6 版）の検証。

import { describe, expect, test } from "vitest";
import { NOTE_ICONS } from "../editor/note-container";
import {
  codeKey,
  collectCodeBlocks,
  markdownTokens,
  renderBody,
  renderHtml,
} from "./export-html";

describe("renderHtml", () => {
  test("test_三重の強調と色つきの字が同じ段落にあっても落ちない", () => {
    // 実機の見本づくりで発覚（2026-09-13）。色の span の中を**同じ token の
    // 配列に**入れ子で組んでいたため、markdown-it の後処理（強調・打ち消し）が
    // 自分の tokens_meta と食い違って undefined を触っていた
    const text =
      '***太字の斜体***、<span style="color: #c0392b">赤い字</span>\n';
    const html = renderHtml(text, "見本");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("#c0392b"); // style は空白を詰めて出る
  });

  test("test_front_matter は出さない（アプリの管理情報）", () => {
    // 実機報告 2026-09-04: 書き出した HTML の頭に created / id / pinned が
    // 大きく出ていた。**画面には出ていないもの**を紙や配布物に出さない
    const text =
      "---\ncreated: 2026-08-28T22:51:36+09:00\nid: 01M14\npinned: true\n---\n\n# 覚書の使い方\n\n本文です。\n";
    const html = renderHtml(text, "覚書の使い方");
    expect(html).not.toContain("created:");
    expect(html).not.toContain("01M14");
    expect(html).toContain("覚書の使い方");
    expect(html).toContain("本文です。");
  });

  test("test_閉じていない区切りは本文として出す（front matter ではない）", () => {
    // `---` で始まるだけの本文まで落とすと、書いたものが消える
    const html = renderHtml("---\n\n本文だけ\n", "t");
    expect(html).toContain("本文だけ");
  });

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

  test("ハイライトの中の装飾も組む（エディタと同じ見え方。21-4）", () => {
    const html = renderHtml("::**太い**印::\n", "t");
    expect(html).toContain("<mark><strong>太い</strong>印</mark>");
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

  test("test_:::details が本物の折りたたみになる（6-2）", () => {
    const md = ":::details 詳しく\n中身の **強調**\n:::\n";
    const html = renderHtml(md, "折りたたみ");
    // **開いた形で出す**（畳んだまま出すと印刷で中身が消える）
    expect(html).toContain("<details open>");
    expect(html).toContain("<summary>詳しく</summary>");
    expect(html).toContain("<strong>強調</strong>");
    expect(html).toContain("</details>");
  });

  test("test_呼び名を書いていなければ既定の呼び名", () => {
    expect(renderHtml(":::details\n中身\n:::\n", "x")).toContain(
      "<summary>詳細</summary>",
    );
  });

  test("test_呼び名の記号はそのまま出さない（そのまま書ける）", () => {
    // `<` を書いても壊れない。囲みの呼び名は文字として出す
    expect(renderHtml(":::details a<b\n中身\n:::\n", "x")).toContain(
      "<summary>a&lt;b</summary>",
    );
  });

  test("test_Qiita から貼った <details> も畳めるまま出す（読むときだけ受ける）", () => {
    const pasted = "<details><summary>詳しく</summary>\n\n中身\n\n</details>\n";
    const html = renderHtml(pasted, "貼り付け");
    expect(html).toContain("<summary>詳しく</summary>");
    expect(html).not.toContain("&lt;details&gt;");
  });

  test("test_囲みの頭に印を出す（要望 2026-09-05）", () => {
    const html = renderHtml(":::note alert\n本文\n:::\n", "印");
    // 画面と同じ印を、書き出した HTML でも出す
    expect(html).toContain(`content: "${NOTE_ICONS.alert}"`);
    expect(html).toContain(".note-alert > :first-child::before");
  });

  test("test_画像の大きさ指定が幅になる（6-8）", () => {
    const html = renderHtml("![犬|300](a.png)\n", "画像");
    expect(html).toContain('width="300"');
    expect(html).toContain('alt="犬"'); // 説明から大きさは落とす
    expect(html).not.toContain("犬|300");
  });

  test("test_縦横を書けば両方付く", () => {
    const html = renderHtml("![犬|300x200](a.png)\n", "画像");
    expect(html).toContain('width="300"');
    expect(html).toContain('height="200"');
  });

  test("test_大きさでない縦棒は説明のまま", () => {
    expect(renderHtml("![表 A|B](a.png)\n", "画像")).toContain('alt="表 A|B"');
  });

  test("test_説明や道の引用符は属性を突き破らない（レビュー 2026-09-07）", () => {
    // 属性値に入るものは `"` も落とさないと、`alt` の外に別の属性を
    // 書き足せてしまう（印刷プレビューは innerHTML で流し込む）
    const html = renderHtml('![犬" onerror="x|300](a.png)\n', "画像");
    expect(html).toContain('alt="犬&quot; onerror=&quot;x"');
    expect(html).not.toContain('" onerror="');
  });

  test("test_言語名の引用符もクラス属性を突き破らない", () => {
    const html = renderHtml('```js" onclick="x\ncode\n```\n', "コード");
    expect(html).not.toContain('" onclick="');
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

// 文字色（ADR-0061）。生の HTML は通さないまま、色の span だけ組み直して通す
describe("文字色の span", () => {
  test("test_受けた色は組み直して通す", () => {
    const html = renderHtml('<span style="color: red; ">赤</span>と地', "t");
    expect(html).toContain('<span style="color:red">赤</span>と地');
  });
  test("test_受けない style は素の文字として逃がす", () => {
    const html = renderHtml(
      '<span style="color: red; font-size: 2em">赤</span>',
      "t",
    );
    expect(html).not.toContain("<span style");
    expect(html).toContain("&lt;span");
  });
  test("test_閉じが無ければ通さない", () => {
    const html = renderHtml('<span style="color: red">赤', "t");
    expect(html).not.toContain("<span style");
  });
});

// 埋め込み（ADR-0058）。HTML / PDF は中身を展開して埋める（読む側に元ノートは無い）
describe("埋め込みの展開", () => {
  test("test_埋め込んだノートの_front_matter_は出さない（本文と同じ。24-4）", () => {
    const embeds = new Map([
      ["n", "---\nid: 01ABC\nmodified: 2026-09-01\n---\n# 題\n\n本文\n"],
    ]);
    const html = renderBody("![[n]]\n", undefined, undefined, embeds);
    expect(html).not.toContain("01ABC");
    expect(html).not.toContain("modified");
    expect(html).not.toContain("<hr");
    expect(html).toContain("<h1>題</h1>");
    // Word が読むトークンも同じ規則（同じ解析を通る）
    const words = markdownTokens("![[n]]\n", embeds)
      .map((token) => token.content)
      .join(" ");
    expect(words).not.toContain("01ABC");
  });

  test("test_行まるごとの ![[名前]] は渡された本文を Markdown として組む", () => {
    const embeds = new Map([["会議メモ", "## 決定\n\n- **a**\n"]]);
    const html = renderHtml(
      "前\n\n![[会議メモ]]\n\n後",
      "t",
      undefined,
      undefined,
      embeds,
    );
    expect(html).toContain("<h2>決定</h2>");
    expect(html).toContain("<strong>a</strong>");
    expect(html).not.toContain("![[");
    expect(html).toContain('class="embed"');
  });
  test("test_解決できないものは素の文字_中の埋め込みは展開しない（深さ 1）", () => {
    const embeds = new Map([
      ["外", "中身 ![[内]]\n"],
      ["内", "深い\n"],
    ]);
    const html = renderHtml(
      "![[無い]]\n\n![[外]]\n",
      "t",
      undefined,
      undefined,
      embeds,
    );
    expect(html).toContain("![[無い]]");
    expect(html).toContain("中身 ![[内]]");
    expect(html).not.toContain("深い");
  });
});

describe("段落と見出しを寄せる囲み（22-3 / ADR-0069）", () => {
  test("test_center_と_right_は寄せの箱になる", () => {
    expect(renderBody(":::center\n題\n:::\n")).toBe(
      '<div class="align-center">\n<p>題</p>\n</div>\n',
    );
    expect(renderBody(":::right\n署名\n:::\n")).toBe(
      '<div class="align-right">\n<p>署名</p>\n</div>\n',
    );
  });

  test("test_寄せるのは段落と見出しだけ（CSS。画面と同じ決定 4）", () => {
    const html = renderHtml(":::center\n題\n:::\n", "t");
    expect(html).toContain(".align-center > p");
    expect(html).toContain(".align-center > h1");
    expect(html).not.toMatch(/\.align-center\s*\{[^}]*text-align/);
  });

  test("test_知らない綴りと閉じの無い開きは字のまま（画面と同じ）", () => {
    expect(renderBody(":::centre\n題\n:::\n")).not.toContain("<div");
    expect(renderBody(":::centre\n題\n:::\n")).toContain(":::centre");
    const open = renderBody(":::center\n題\n");
    expect(open).not.toContain("<div");
    expect(open).toContain(":::center");
  });

  test("test_入れ子は組まない_開いている間の開きは字のまま（決定 3）", () => {
    const html = renderBody(":::note\n:::center\n文\n:::\n:::\n");
    expect(html).not.toContain("align-center");
    expect(html).toContain(
      '<div class="note note-info">\n<p>:::center\n文</p>\n</div>',
    );
    // 余った閉じは字のまま
    expect(html).toContain("<p>:::</p>");
  });

  test("test_中のフェンスの_:::_では閉じない（画面と同じ）", () => {
    const html = renderBody(":::note\n```\n:::\n```\n後の文\n:::\n");
    expect(html).toBe(
      '<div class="note note-info">\n<pre><code>:::\n</code></pre>\n<p>後の文</p>\n</div>\n',
    );
  });

  test("test_コードの中の囲みの行は変えない", () => {
    expect(renderBody("```\n:::center\n題\n:::\n```\n")).toBe(
      "<pre><code>:::center\n題\n:::\n</code></pre>\n",
    );
  });

  test("test_引用の中の_:::_は囲みにしない（行頭から始まるものだけ。画面と同じ）", () => {
    expect(renderBody("> :::note\n> 中\n> :::\n")).not.toContain("note-info");
  });

  test("test_Word_が読むトークンも同じ（寄せの箱の開きと閉じ）", () => {
    const types = markdownTokens(":::center\n題\n:::\n").map((t) => t.type);
    expect(types[0]).toBe("container_center_open");
    expect(types[types.length - 1]).toBe("container_center_close");
  });

  test("test_埋め込んだ本文の囲みも同じ規則", () => {
    const embeds = new Map([["署名", ":::right\n野村\n:::\n"]]);
    const html = renderBody("![[署名]]\n", undefined, undefined, embeds);
    expect(html).toContain('<div class="align-right">\n<p>野村</p>\n</div>');
  });

  test("test_寄せの_HTML_も同じ箱になる_中は_Markdown_として組む（23-2）", () => {
    expect(renderBody('<div align="center">\n# 題\n**太字**\n</div>\n')).toBe(
      '<div class="align-center">\n<h1>題</h1>\n<p><strong>太字</strong></p>\n</div>\n',
    );
    expect(renderBody("<p align='right'>\n署名\n</p>\n")).toBe(
      '<div class="align-right">\n<p>署名</p>\n</div>\n',
    );
    // 決めた形でない HTML は今までどおり字のまま（html: false）
    expect(renderBody('<div class="x">\n題\n</div>\n')).toContain("&lt;div");
  });

  test("test_1_行の寄せの_HTML_も同じ箱になる（23-2 後半）", () => {
    expect(renderBody('<p align="center">題と**強調**</p>\n')).toBe(
      '<div class="align-center">\n<p>題と<strong>強調</strong></p>\n</div>\n',
    );
  });
});
