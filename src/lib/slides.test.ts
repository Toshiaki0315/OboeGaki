// Markdown をスライドの構造に割る（TASKS 4-5 / F-4）。
// 区切りは参照実装 core/slides.py と同じ（ユーザーと決めた並べ方）。

import { describe, expect, test } from "vitest";
import { splitDeck } from "./slides";

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
    expect(deck.slides[0].blocks).toEqual([
      { kind: "paragraph", text: "本文 A" },
    ]);
  });

  test("箇条書きは階層を持つ", () => {
    const deck = splitDeck("## A\n\n- 一段目\n    - 二段目\n");
    expect(deck.slides[0].blocks).toEqual([
      { kind: "bullet", text: "一段目", level: 0 },
      { kind: "bullet", text: "二段目", level: 1 },
    ]);
  });

  test("`###` はスライドの中の小見出し", () => {
    const deck = splitDeck("## A\n\n### 小見出し\n\n本文\n");
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "heading",
      text: "小見出し",
    });
  });

  test("画像は本文に混ぜず、右側に置くものとして分ける", () => {
    const deck = splitDeck("## A\n\n本文\n\n![](attachments/図.png)\n");
    expect(deck.slides[0].images).toEqual(["attachments/図.png"]);
    expect(deck.slides[0].blocks).toEqual([
      { kind: "paragraph", text: "本文" },
    ]);
  });

  test("引用は発表者ノート（スライドには出さない）", () => {
    const deck = splitDeck("## A\n\n> ここは話すこと\n\n本文\n");
    expect(deck.slides[0].notes).toBe("ここは話すこと");
    expect(deck.slides[0].blocks).toEqual([
      { kind: "paragraph", text: "本文" },
    ]);
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
    expect(deck.slides[0].blocks[0]).toEqual({
      kind: "paragraph",
      text: "強調した本文",
    });
  });
});
