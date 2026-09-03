// PowerPoint の取り込み（TASKS 4-5 / F-3）。
// ざっくり読んで手で直す前提。ここでは構造 → Markdown の規則を見る。

import { describe, expect, test } from "vitest";
import {
  isPageNumber,
  looksLikeHeading,
  normalizeText,
  slidesToMarkdown,
} from "./pptx-import";

const run = (text: string, extra: { bold?: boolean; mono?: boolean } = {}) => ({
  text,
  bold: extra.bold ?? false,
  mono: extra.mono ?? false,
});

const para = (
  text: string,
  extra: { level?: number; bulletNone?: boolean } = {},
) => ({
  runs: [run(text)],
  level: extra.level ?? 0,
  bulletNone: extra.bulletNone ?? false,
});

describe("normalizeText", () => {
  test("部首や互換文字を揃える（検索に掛かるように）", () => {
    // `本⽇`（KANGXI RADICAL SUN）のままだと「本日」で見つからない
    expect(normalizeText("本⽇")).toBe("本日");
  });

  test("全角の約物は変えない（取り込んだだけで句読点を変えない）", () => {
    expect(normalizeText("（注）")).toBe("（注）");
  });
});

describe("isPageNumber", () => {
  test("番号だけの行", () => {
    expect(isPageNumber("12")).toBe(true);
    expect(isPageNumber("- 12 -")).toBe(true);
  });

  test("**迷ったら残す**（年や見出し番号は消さない）", () => {
    expect(isPageNumber("2026")).toBe(false);
    expect(isPageNumber("1. はじめに")).toBe(false);
  });
});

describe("looksLikeHeading", () => {
  test("短くて文の終わりが無いもの", () => {
    expect(looksLikeHeading("背景と目的")).toBe(true);
    expect(looksLikeHeading("これは本文です。")).toBe(false);
    expect(looksLikeHeading("- 箇条書き")).toBe(false);
  });
});

describe("slidesToMarkdown", () => {
  test("タイトルは `##`、発表者ノートは引用にする", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "1 枚目",
        shapes: [{ kind: "text", paragraphs: [para("本文です。")] }],
        notes: "話すこと",
      },
    ]);
    expect(md).toContain("# 資料");
    expect(md).toContain("## 1 枚目");
    expect(md).toContain("本文です。");
    expect(md).toContain("> 話すこと");
  });

  test("文の終わりで終わる段落は本文、そうでなければ箇条書き", () => {
    // PowerPoint は平文と第 1 階層の箇条書きを区別しない。これが手掛かり
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: [para("これは本文です。"), para("項目")],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("これは本文です。");
    expect(md).toContain("- 項目");
  });

  test("字下げされた段落は箇条書き（書いた人が階層を意識している）", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          { kind: "text", paragraphs: [para("下の段です。", { level: 1 })] },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("    - 下の段です。");
  });

  test("行頭記号なしの短い段落は `###`", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: [para("背景", { bulletNone: true })],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("### 背景");
  });

  test("太字と等幅は記号に戻す", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: [
              {
                runs: [
                  run("これは "),
                  run("大事", { bold: true }),
                  run(" と "),
                  run("AWS", { mono: true }),
                ],
                level: 0,
                bulletNone: false,
              },
            ],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("**大事**");
    expect(md).toContain("`AWS`");
  });

  test("等幅の枠まるごとはコードブロック（中は触らない）", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            mono: true,
            paragraphs: [para("def f():"), para("    return 1")],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("```\ndef f():\n    return 1\n```");
  });

  test("表は Markdown の表にする", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "table",
            rows: [
              ["項目", "内容"],
              ["期間", "1 年"],
            ],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("| 項目 | 内容 |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 期間 | 1 年 |");
  });

  test("ページ番号だけの段落は落とす", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [{ kind: "text", paragraphs: [para("12")] }],
        notes: "",
      },
    ]);
    expect(md).not.toContain("12");
  });

  test("中身が無ければ空（題名だけのノートを作らせない）", () => {
    expect(slidesToMarkdown("資料", [])).toBe("");
    expect(
      slidesToMarkdown("資料", [
        { title: "", shapes: [{ kind: "text", paragraphs: [] }], notes: "" },
      ]),
    ).toBe("");
  });
});
