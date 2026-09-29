// Markdown をスライドの構造に割る（TASKS 4-5 / F-4）。
// 区切りは参照実装 core/slides.py と同じ（ユーザーと決めた並べ方）。

import { describe, expect, it, test } from "vitest";
import {
  cardsOf,
  diagramsAsImages,
  MERMAID_IMAGE_PREFIX,
  plainText,
  splitDeck,
  type SlideBlock,
  codeBlocksOf,
} from "./slides";

/// 本文だけを見たいテスト用（装飾は runs が持つ）
const said = (block: SlideBlock) =>
  "runs" in block ? plainText(block.runs) : "";

/// 装飾ごと見たいテスト用（コード・表には runs が無い）
const runsOf = (block: SlideBlock) => ("runs" in block ? block.runs : []);
const plainOf = (block: SlideBlock) => plainText(runsOf(block));

describe("囲みの行はスライドに出さない（22-P）", () => {
  const blocksOf = (body: string) =>
    splitDeck(`## A\n\n${body}\n`).slides[0].blocks.map((block) => [
      block.kind,
      block.kind === "code" ? block.text : said(block),
    ]);

  test("test_note_と_details_は中身だけ残す", () => {
    expect(blocksOf(":::note warn\n注意\n:::")).toEqual([
      ["paragraph", "注意"],
    ]);
    expect(blocksOf(":::details 詳しく\n中身\n:::")).toEqual([
      ["paragraph", "中身"],
    ]);
  });

  test("test_前後の段落とは別の段落になる", () => {
    expect(blocksOf("前\n:::note\n注意\n:::\n後")).toEqual([
      ["paragraph", "前"],
      ["paragraph", "注意"],
      ["paragraph", "後"],
    ]);
  });

  test("test_中の箇条書きに閉じの行が混ざらない", () => {
    expect(blocksOf(":::note\n- a\n- b\n:::")).toEqual([
      ["bullet", "a"],
      ["bullet", "b"],
    ]);
  });

  test("test_コードの中の囲みの行はそのまま残す", () => {
    expect(blocksOf("```\n:::note\nx\n:::\n```")).toEqual([
      ["code", ":::note\nx\n:::"],
    ]);
    expect(blocksOf(":::note\n```\n:::\n```\n:::")).toEqual([["code", ":::"]]);
  });

  test("test_寄せの囲みの行も出さない（22-1 で見つけ方に入った。寄せるのは 22-5）", () => {
    expect(blocksOf(":::center\n題\n:::")).toEqual([["paragraph", "題"]]);
  });

  test("test_閉じの無い開きは字のまま（画面と同じ）", () => {
    expect(blocksOf(":::note\n本文")).toEqual([["paragraph", ":::note 本文"]]);
  });
});

describe("段落と見出しを寄せる囲み（22-5 / ADR-0069）", () => {
  const alignsOf = (markdown: string) =>
    splitDeck(markdown).slides.map((slide) =>
      slide.blocks.map((block) => [
        block.kind,
        "runs" in block ? plainText(block.runs) : "",
        "align" in block ? (block.align ?? null) : null,
      ]),
    );

  test("test_中の段落と小見出しに寄せを持たせる", () => {
    expect(
      alignsOf(
        "## A\n\n:::center\n### 小見出し\n段落\n:::\n\n:::right\n署名\n:::\n\n後",
      ),
    ).toEqual([
      [
        ["heading", "小見出し", "center"],
        ["paragraph", "段落", "center"],
        ["paragraph", "署名", "right"],
        ["paragraph", "後", null],
      ],
    ]);
  });

  test("test_箇条書きとコードは寄せない（決定 4）", () => {
    expect(alignsOf("## A\n\n:::center\n- 項目\n\n```\nx\n```\n:::\n")).toEqual(
      [
        [
          ["bullet", "項目", null],
          ["code", "", null],
        ],
      ],
    );
  });

  test("test_寄せの_HTML_も同じに寄せる（23-2）", () => {
    expect(alignsOf('## A\n\n<div align="center">\n段落\n</div>\n')).toEqual([
      [["paragraph", "段落", "center"]],
    ]);
  });

  test("test_1_行の寄せの_HTML_も寄せる（23-2 後半）", () => {
    expect(alignsOf('## A\n\n<p align="right">署名</p>\n\n後')).toEqual([
      [
        ["paragraph", "署名", "right"],
        ["paragraph", "後", null],
      ],
    ]);
  });

  test("test_枚が替わるところで囲みも切れる（`##` から先は寄せない）", () => {
    expect(alignsOf("## A\n\n:::center\n一\n\n## B\n\n二\n:::\n")).toEqual([
      [["paragraph", "一", "center"]],
      [["paragraph", "二", null]],
    ]);
  });
});

describe("行内の書き方（24-5。HTML・Word と同じに組む）", () => {
  const paragraphOf = (body: string) => {
    const block = splitDeck(`## A\n\n${body}\n`).slides[0].blocks[0];
    return block;
  };
  const textOf = (body: string) => said(paragraphOf(body));

  test("test_自動リンクは_URL_を残してリンクにする", () => {
    expect(textOf("see <https://x.example> here")).toBe(
      "see https://x.example here",
    );
    expect(
      runsOf(paragraphOf("see <https://x.example> here")).some(
        (run) => run.link === "https://x.example",
      ),
    ).toBe(true);
  });

  test("test_リンクの題は出さない", () => {
    expect(textOf('[t](https://u.example "ttl")')).toBe("t");
  });

  test("test_逃がした記号はその字だけにする", () => {
    expect(textOf("1\\*2 と \\# と \\[x\\]")).toBe("1*2 と # と [x]");
  });

  test("test_文字参照は字に戻す", () => {
    expect(textOf("&amp; &lt;b&gt; &quot;q&quot; &#x41;&#66; &copy;")).toBe(
      '& <b> "q" AB ©',
    );
  });

  test("test_バックスラッシュの改行は改行にする（ふつうの改行と同じ）", () => {
    expect(textOf("一\\\n二")).toBe(textOf("一\n二"));
  });
});

describe("front matter（24-5）", () => {
  test("test_front_matter_は本文として読まない（表紙の題や副題にならない）", () => {
    // YAML のコメント行が表紙の題になり、本当の `# T` が扉に落ちていた。リストや
    // 空行を含む front matter は副題に入っていた
    const deck = splitDeck(
      "---\n# 設定\ntags:\n  - a\n\nslide-font: X\n---\n# T\n\n副題の文\n\n## A\n\n本文\n",
    );
    expect(deck.title).toBe("T");
    expect(deck.subtitle).toBe("副題の文");
    expect(deck.slides.map((slide) => slide.title)).toEqual(["A"]);
  });
});

describe("字下げのコード（24-4）", () => {
  test("test_字下げのコードは全部の行を残す_空行も", () => {
    // Lezer は字下げのコードを 1 行ずつ別の CodeText に分ける。以前は最初の 1 つだけ
    // 読んでいて、2 行目以降が黙って消えた
    const deck = splitDeck("## A\n\n    l1\n    l2\n\n      l3\n");
    const code = deck.slides[0].blocks.find((block) => block.kind === "code");
    expect(code?.kind === "code" && code.text).toBe("l1\nl2\n\n  l3");
  });
});

describe("画像の説明（CFG-72 / TASKS 8-2 の積み残し）", () => {
  it("test_道と説明の両方を持つ", () => {
    const deck = splitDeck("## A\n\n![犬の写真](dog.png)\n");
    expect(deck.slides[0].images).toEqual([
      { url: "dog.png", alt: "犬の写真" },
    ]);
  });

  it("test_説明が無ければ空", () => {
    const deck = splitDeck("## A\n\n![](dog.png)\n");
    expect(deck.slides[0].images[0].alt).toBe("");
  });

  it("test_大きさ指定は説明から外す（6-8 の `|300`）", () => {
    const deck = splitDeck("## A\n\n![犬|300](dog.png)\n");
    expect(deck.slides[0].images[0].alt).toBe("犬");
  });
});

describe("分ける見出しのレベル（CFG-40 / TASKS 8-2）", () => {
  const doc = `# 題

前書き

## A

あ

### A-1

い

## B

う
`;

  it("test_既定は見出し 2 で分ける（今までどおり）", () => {
    const deck = splitDeck(doc);
    expect(deck.title).toBe("題");
    expect(deck.slides.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("test_見出し 1 で分けると、2 つ目以降の # が本文の枚になる", () => {
    const deck = splitDeck("# 題\n\nあ\n\n# 次\n\nい\n", 1);
    expect(deck.title).toBe("題");
    expect(deck.slides.map((s) => [s.kind, s.title])).toEqual([
      ["content", "次"],
    ]);
  });

  it("test_見出し 3 で分けると、## は扉になり ### が枚になる", () => {
    const deck = splitDeck(doc, 3);
    expect(deck.slides.map((s) => [s.kind, s.title])).toEqual([
      ["section", "A"],
      ["content", "A-1"],
      ["section", "B"],
    ]);
  });

  it("test_分ける深さより深い見出しは枚の中の小見出し", () => {
    const deck = splitDeck(doc, 2);
    const found = deck.slides[0].blocks.find((b) => b.kind === "heading");
    expect(found).toBeTruthy();
  });
});

describe("splitDeck", () => {
  test("`#` は表紙。その前後の段落が副題になる", () => {
    const deck = splitDeck(
      "# 発表の題\n\n2026-09-04 / 覚書チーム\n\n## 1 枚目\n",
    );
    expect(deck.title).toBe("発表の題");
    expect(deck.subtitle).toBe("2026-09-04 / 覚書チーム");
    expect(deck.slides.length).toBe(1);
  });

  test("`##` ごとに 1 枚", () => {
    const deck = splitDeck("## A\n\n本文 A\n\n## B\n\n本文 B\n");
    expect(deck.slides.map((slide) => slide.title)).toEqual(["A", "B"]);
    expect(deck.slides[0].blocks.map(said)).toEqual(["本文 A"]);
  });

  test("箇条書きは階層を持つ", () => {
    const deck = splitDeck("## A\n\n- 一段目\n    - 二段目\n");
    expect(deck.slides[0].blocks.map(said)).toEqual(["一段目", "二段目"]);
    expect(deck.slides[0].blocks.map((block) => block.kind)).toEqual([
      "bullet",
      "bullet",
    ]);
    expect(
      deck.slides[0].blocks.map((block) =>
        block.kind === "bullet" ? block.level : null,
      ),
    ).toEqual([0, 1]);
  });

  test("`###` はスライドの中の小見出し", () => {
    const deck = splitDeck("## A\n\n### 小見出し\n\n本文\n");
    expect(deck.slides[0].blocks[0].kind).toBe("heading");
    expect(said(deck.slides[0].blocks[0])).toBe("小見出し");
  });

  test("画像は本文に混ぜず、右側に置くものとして分ける", () => {
    const deck = splitDeck("## A\n\n本文\n\n![](attachments/図.png)\n");
    expect(deck.slides[0].images).toEqual([
      { url: "attachments/図.png", alt: "" },
    ]);
    expect(deck.slides[0].blocks.map(said)).toEqual(["本文"]);
  });

  test("引用は発表者ノート（スライドには出さない）", () => {
    const deck = splitDeck("## A\n\n> ここは話すこと\n\n本文\n");
    expect(deck.slides[0].notes).toBe("ここは話すこと");
    expect(deck.slides[0].blocks.map(said)).toEqual(["本文"]);
  });

  test("コードは言語ごと持つ", () => {
    const deck = splitDeck("## A\n\n```python\ndef f():\n    return 1\n```\n");
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "code",
      text: "def f():\n    return 1",
      language: "python",
    });
  });

  test("表はセルごとの run で持つ（区切り行は落とす）", () => {
    const deck = splitDeck("## A\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "table",
      rows: [
        [[{ text: "a" }], [{ text: "b" }]],
        [[{ text: "1" }], [{ text: "2" }]],
      ],
    });
  });

  test("表のセル: `\\|` は区切りでなく字_装飾は run に_空のセルは列を保つ", () => {
    // 行のまま `split("|")` していたので、`\|` で列がずれ、`**` がそのまま
    // 載っていた（棚卸し 2026-09-17）
    const deck = splitDeck(
      "## A\n\n| a \\| b | **c** |\n| --- | --- |\n| x |  |\n",
    );
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "table",
      rows: [
        [[{ text: "a | b" }], [{ text: "c", bold: true }]],
        [[{ text: "x" }], []],
      ],
    });
  });

  test("test_行ごとにセル数が違う表は_見出しの列数に揃える（GFM。21-3）", () => {
    // pptxgenjs は列の数を 1 行目から数えるので、揃えないと XML の tc と gridCol が
    // 食い違う（レビュー 2026-09-24）
    const deck = splitDeck(
      "## A\n\n| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n| 4 |\n",
    );
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "table",
      rows: [
        [[{ text: "a" }], [{ text: "b" }]],
        [[{ text: "1" }], [{ text: "2" }]],
        [[{ text: "4" }], []],
      ],
    });
  });

  test("test_見出しの色_span_はスライドの題に生で載せない（21-3）", () => {
    const deck = splitDeck(
      '# <span style="color: #e53935">赤</span>い題\n\n## <span style="color: red">青</span>い節\n',
    );
    expect(deck.title).toBe("赤い題");
    expect(deck.slides[0].title).toBe("青い節");
  });

  test("front matter は見ない（アプリの管理情報）", () => {
    const deck = splitDeck("---\npinned: true\n---\n# 題\n\n## A\n");
    expect(deck.title).toBe("題");
    expect(deck.slides.length).toBe(1);
  });

  test("`##` が無ければ表紙だけ", () => {
    const deck = splitDeck("# 題だけ\n\n副題\n");
    expect(deck.slides).toEqual([]);
    expect(deck.subtitle).toBe("副題");
  });

  test("装飾の記号は落とす（スライドに `**` を出さない）", () => {
    const deck = splitDeck("## A\n\n**強調**した本文\n");
    expect(said(deck.slides[0].blocks[0])).toBe("強調した本文");
  });

  // --- 装飾そのものは残す（TASKS 5-1） ---

  test("test_太字_斜体_打ち消し_コードを保つ", () => {
    // **記号は落とすが、装飾は落とさない。** 素の文字になると、書いた人が
    // PowerPoint 側で付け直すことになる
    const deck = splitDeck(
      "## A\n\n**太字**と*斜体*と~~打ち消し~~と`コード`\n",
    );
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "太字", bold: true },
      { text: "と" },
      { text: "斜体", italic: true },
      { text: "と" },
      { text: "打ち消し", strike: true },
      { text: "と" },
      { text: "コード", code: true },
    ]);
  });

  test("test_文字色の span は run の色にし_タグは出さない（ADR-0061）", () => {
    const deck = splitDeck(
      '## A\n\n<span style="color: #E53935">赤い</span>字と**<span style="color: red">太い赤</span>**\n',
    );
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "赤い", color: "E53935" },
      { text: "字と" },
      { text: "太い赤", bold: true, color: "FF0000" },
    ]);
  });

  test("test_リンクは行き先ごと持つ", () => {
    const deck = splitDeck("## A\n\n[覚書](https://example.com/a) を見る\n");
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "覚書", link: "https://example.com/a" },
      { text: " を見る" },
    ]);
  });

  test("test_入れ子の装飾は重ねる", () => {
    const deck = splitDeck("## A\n\n**太字の*中の斜体*です**\n");
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "太字の", bold: true },
      { text: "中の斜体", bold: true, italic: true },
      { text: "です", bold: true },
    ]);
  });

  test("test_箇条書きと小見出しでも装飾が残る", () => {
    const deck = splitDeck("## A\n\n- **強い**項目\n");
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "強い", bold: true },
      { text: "項目" },
    ]);
  });

  // --- 段組み / カード（TASKS 5-4） ---

  test("test_小見出しが2つ以上あれば横並びの箱にする", () => {
    const deck = splitDeck("## A\n\n### 前\n\n落ちる\n\n### 後\n\n残る\n");
    const cards = cardsOf(deck.slides[0].blocks);
    expect(cards?.map((card) => plainText(card.heading))).toEqual(["前", "後"]);
    expect(cards?.map((card) => card.blocks.map(plainOf))).toEqual([
      ["落ちる"],
      ["残る"],
    ]);
  });

  test("test_小見出しが1つだけなら箱にしない", () => {
    // 1 つを箱にしても段組みにならない。今までどおり縦に流す
    const deck = splitDeck("## A\n\n### 見出し\n\n本文\n");
    expect(cardsOf(deck.slides[0].blocks)).toBeNull();
  });

  test("test_小見出しの前に本文があれば箱にしない", () => {
    // 箱に入らない文が浮く。**迷ったら今までの並べ方に倒す**
    const deck = splitDeck("## A\n\n前置き\n\n### 前\n\nx\n\n### 後\n\ny\n");
    expect(cardsOf(deck.slides[0].blocks)).toBeNull();
  });

  test("test_コードや表があれば箱にしない", () => {
    // 幅が要るものは横に割ると読めなくなる
    const deck = splitDeck(
      "## A\n\n### 前\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n### 後\n\ny\n",
    );
    expect(cardsOf(deck.slides[0].blocks)).toBeNull();
  });

  test("test_箱は4つまで（5つ以上は縦に流す）", () => {
    const many = [
      "## A",
      ...Array.from({ length: 5 }, (_, i) => `### ${i}\n\nx`),
    ].join("\n\n");
    expect(cardsOf(splitDeck(many).slides[0].blocks)).toBeNull();
  });

  // --- スライドの体裁（TASKS 5-3） ---

  test("test_2つ目以降の見出し1はセクション扉になる", () => {
    // いままで**捨てていた**（表紙にしか使わず、2 つ目以降は消えた）
    const deck = splitDeck("# 題\n\n## A\n\n# 第 2 部\n\n## B\n");
    expect(deck.slides.map((slide) => [slide.kind, slide.title])).toEqual([
      ["content", "A"],
      ["section", "第 2 部"],
      ["content", "B"],
    ]);
  });

  test("test_扉のあとの本文はその次のスライドへ", () => {
    // 扉は題だけ。本文が混ざると扉に見えない
    const deck = splitDeck("# 第 2 部\n\n段落\n\n## B\n\n本文\n");
    expect(deck.slides[0].kind).toBe("content");
  });

  test("test_前後の空白は落として途中の空白は残す", () => {
    const deck = splitDeck("## A\n\n  a **b** c  \n");
    expect(runsOf(deck.slides[0].blocks[0])).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c" },
    ]);
  });
});

describe("diagramsAsImages（Mermaid を図として書き出す。要望 2026-09-08）", () => {
  const md =
    "## A\n\n説明。\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n```python\nprint(1)\n```\n";

  test("test_Mermaid のコードは画像に置き換わり_他のコードは残る", () => {
    const deck = diagramsAsImages(splitDeck(md));
    const slide = deck.slides[0];
    expect(slide.blocks.map((b) => b.kind)).toEqual(["paragraph", "code"]);
    expect(slide.images).toEqual([
      { url: `${MERMAID_IMAGE_PREFIX}graph TD\n  A --> B`, alt: "" },
    ]);
  });

  test("test_描けなかった図はコードのまま残す", () => {
    const deck = diagramsAsImages(splitDeck(md), () => false);
    expect(deck.slides[0].blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "code",
      "code",
    ]);
    expect(deck.slides[0].images).toEqual([]);
  });

  test("test_元の画像の後ろに並ぶ", () => {
    const deck = diagramsAsImages(
      splitDeck("## A\n\n![写真](a.png)\n\n```mermaid\ngraph LR\n```\n"),
    );
    expect(deck.slides[0].images.map((i) => i.url)).toEqual([
      "a.png",
      `${MERMAID_IMAGE_PREFIX}graph LR`,
    ]);
  });
});

describe("codeBlocksOf", () => {
  test("test_全部のスライドのコードの塊を言語つきで集める（12-12）", () => {
    const deck = splitDeck(
      "## A\n\n```js\nconst x = 1;\n```\n\n## B\n\n本文\n\n```\nplain\n```\n",
    );
    expect(codeBlocksOf(deck)).toEqual([
      { language: "js", text: "const x = 1;" },
      { language: "", text: "plain" },
    ]);
  });
});
