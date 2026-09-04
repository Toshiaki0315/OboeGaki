// Markdown をスライドの構造に割る（TASKS 4-5 / F-4）。
// 区切りは参照実装 core/slides.py と同じ（ユーザーと決めた並べ方）。

import { describe, expect, test } from "vitest";
import { plainText, splitDeck, type SlideBlock } from "./slides";

/// 本文だけを見たいテスト用（装飾は runs が持つ）
const said = (block: SlideBlock) =>
  "runs" in block ? plainText(block.runs) : "";

/// 装飾ごと見たいテスト用（コード・表には runs が無い）
const runsOf = (block: SlideBlock) => ("runs" in block ? block.runs : []);

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
    expect(deck.slides[0].images).toEqual(["attachments/図.png"]);
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

  test("表は行のまま持つ（セルには割らない）", () => {
    const deck = splitDeck("## A\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "table",
      rows: ["| a | b |", "| 1 | 2 |"],
    });
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
