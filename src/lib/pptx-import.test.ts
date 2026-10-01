// @vitest-environment jsdom
// PowerPoint の取り込み（TASKS 4-5 / F-3）。
// ざっくり読んで手で直す前提。ここでは構造 → Markdown の規則を見る。

import { describe, expect, test } from "vitest";
import JSZip from "jszip";
import {
  isPageNumber,
  looksLikeHeading,
  normalizeText,
  readPptx,
  slidesToMarkdown,
} from "./pptx-import";
import { splitDeck } from "./slides";

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

describe("読み込んだ Markdown が崩れない（24-5）", () => {
  test("test_隣り合う太字の字の単位はまとめて囲む（****_を残さない）", () => {
    // 実際の .pptx は、言語や校正の印の違いだけで同じ太字が細かく割れる。以前は
    // 1 つずつ囲んで `**太字****続き**` になり、`****` が字のまま出た
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: [
              {
                runs: [
                  run("前 "),
                  run("太字", { bold: true }),
                  run("続き", { bold: true }),
                  run(" 後"),
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
    expect(md).toContain("**太字続き**");
    expect(md).not.toContain("****");
  });

  test("test_表のセルの縦棒は逃がす（列がずれない）", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "table",
            rows: [
              ["項目", "値"],
              ["a|b", "1"],
            ],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("| a\\|b | 1 |");
  });
});

describe("タイトル枠の無いスライド（要望 2026-10-01）", () => {
  // 生成した資料などは、題をただの文字の枠で置いていて、タイトル枠（placeholder）が
  // 無い。以前は `##` が 1 つも出ず、書き出すと全部が 1 枚になった
  type Box = { text: string[]; size?: number; y?: number; title?: boolean };
  const box = ({ text, size, y = 1000000, title }: Box) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/><p:cNvSpPr/><p:nvPr>${
      title ? '<p:ph type="title"/>' : ""
    }</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr><p:txBody>${text
      .map(
        (line) =>
          `<a:p><a:r><a:rPr lang="ja-JP"${size ? ` sz="${size}"` : ""}/><a:t>${line}</a:t></a:r></a:p>`,
      )
      .join("")}</p:txBody></p:sp>`;
  const slideXml = (boxes: Box[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${boxes
      .map(box)
      .join("")}</p:spTree></p:cSld></p:sld>`;
  const notesXml = (text: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  async function deckOf(slides: Box[][], notes: string[] = []) {
    const zip = new JSZip();
    slides.forEach((boxes, index) => {
      zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(boxes));
      if (notes[index])
        zip.file(
          `ppt/notesSlides/notesSlide${index + 1}.xml`,
          notesXml(notes[index]),
        );
    });
    return readPptx(await zip.generateAsync({ type: "uint8array" }));
  }

  test("test_いちばん大きい字の短い枠を題にし_本文からは外す", async () => {
    const [slide] = await deckOf([
      [
        { text: ["工場の現場で取り組んだ事例です。"], size: 1400, y: 2000000 },
        { text: ["自己紹介"], size: 2400, y: 540000 },
        { text: ["野村"], size: 1200, y: 3000000 },
      ],
    ]);
    expect(slide.title).toBe("自己紹介");
    const md = slidesToMarkdown("資料", [slide]);
    expect(md).toContain("## 自己紹介");
    expect(md).not.toContain("- 自己紹介");
    expect(md).toContain("工場の現場で取り組んだ事例です。");
  });

  test("test_大きい番号だけの枠や長い文は題にしない", async () => {
    // 章の扉の大きな「1」や、大きな字の長い文は題ではない
    const [slide] = await deckOf([
      [
        { text: ["1"], size: 4950, y: 1000000 },
        { text: ["あ".repeat(80)], size: 4000, y: 500000 },
        { text: ["ITで設備を制御する"], size: 3600, y: 1950000 },
      ],
    ]);
    expect(slide.title).toBe("ITで設備を制御する");
  });

  test("test_2_行の題は日本語の境目では空白を挟まずに繋ぐ", async () => {
    const [slide] = await deckOf([
      [{ text: ["課題への個別対応は", "「モグラ叩き」になる"], size: 4000 }],
      [{ text: ["Smart", "Factory"], size: 4000 }],
    ]).then((slides) => slides);
    expect(slide.title).toBe("課題への個別対応は「モグラ叩き」になる");
    const [, latin] = await deckOf([
      [{ text: ["a"], size: 1 }],
      [{ text: ["Smart", "Factory"], size: 4000 }],
    ]);
    expect(latin.title).toBe("Smart Factory");
  });

  test("test_同じ大きさなら上にある枠を題にする", async () => {
    const [slide] = await deckOf([
      [
        { text: ["下の見出し"], size: 2400, y: 3000000 },
        { text: ["上の見出し"], size: 2400, y: 500000 },
      ],
    ]);
    expect(slide.title).toBe("上の見出し");
  });

  test("test_タイトル枠があればそちらが先", async () => {
    const [slide] = await deckOf([
      [
        { text: ["大きな字の言葉"], size: 4000 },
        { text: ["本当の題"], size: 2000, title: true },
      ],
    ]);
    expect(slide.title).toBe("本当の題");
  });

  test("test_字の大きさが分からなければ_今までどおり題を決めない", async () => {
    const [slide] = await deckOf([
      [{ text: ["言葉"] }, { text: ["別の言葉"] }],
    ]);
    expect(slide.title).toBe("");
  });

  test("test_題の無いスライドも_書き出すと_1_枚のまま", async () => {
    // 発表者ノートだけのスライドなど。題が無いと前のスライドに混ざって枚数が減る
    const slides = await deckOf(
      [
        [{ text: ["はじめに"], size: 2400 }],
        [{ text: ["本日のまとめ"], size: 2400 }],
        [],
      ],
      ["", "", "質疑の間はこのまま"],
    );
    const md = slidesToMarkdown("資料", slides);
    expect(md).toContain("## スライド 3");
    expect(splitDeck(md).slides).toHaveLength(3);
  });
});
