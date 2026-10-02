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
  extra: { level?: number; bulletNone?: boolean; centered?: boolean } = {},
) => ({
  runs: [run(text)],
  level: extra.level ?? 0,
  bulletNone: extra.bulletNone ?? false,
  centered: extra.centered ?? false,
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
  type Box = {
    text: string[];
    size?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    bold?: boolean;
    title?: boolean;
    /// 本文の枠（placeholder。行頭記号が既定で付く）
    body?: boolean;
    /// 行頭記号を外した段落（`<a:buNone/>`）
    bulletNone?: boolean;
  };
  const box = ({
    text,
    size,
    x = 0,
    y = 1000000,
    w = 1,
    h = 1,
    bold,
    title,
    body,
    bulletNone,
  }: Box) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/><p:cNvSpPr/><p:nvPr>${
      title ? '<p:ph type="title"/>' : body ? '<p:ph type="body" idx="1"/>' : ""
    }</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr><p:txBody>${text
      .map(
        (line) =>
          `<a:p>${bulletNone ? "<a:pPr><a:buNone/></a:pPr>" : ""}<a:r><a:rPr lang="ja-JP"${size ? ` sz="${size}"` : ""}${bold ? ' b="1"' : ""}/><a:t>${line}</a:t></a:r></a:p>`,
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

  // ---------------------------------------------- 18-8（見本-図の枠.pptx で見つけた 2 つ）

  test("test_ただの文字の枠では_記号の無い短い行を見出しにしない（18-8）", async () => {
    // ただの文字の枠は元々行頭記号が付かないので、buNone は「外した」印にならない。
    // 生成した資料は全段落に buNone が書いてあり、短い行が全部 `###` になっていた
    const [slide] = await deckOf([
      [
        { text: ["概要"], size: 3200, y: 300000 },
        { text: ["背景", "目的"], size: 1800, bulletNone: true },
      ],
    ]);
    const md = slidesToMarkdown("資料", [slide]);
    expect(md).toContain("- 背景\n- 目的");
    expect(md).not.toContain("### ");
  });

  test("test_本文の枠では_今までどおり記号を外した短い行を見出しにする（18-8）", async () => {
    const [slide] = await deckOf([
      [
        { text: ["概要"], title: true },
        { text: ["背景"], size: 1800, body: true, bulletNone: true },
      ],
    ]);
    expect(slidesToMarkdown("資料", [slide])).toContain("### 背景");
  });

  test("test_章の扉の大きな番号は_題の頭に付ける（18-8）", async () => {
    const [slide] = await deckOf([
      [
        { text: ["2"], size: 7200, y: 1000000 },
        { text: ["章の扉"], size: 3200, y: 1500000 },
      ],
    ]);
    expect(slide.title).toBe("2 章の扉");
    const md = slidesToMarkdown("資料", [slide]);
    expect(md).toContain("## 2 章の扉");
    expect(md.match(/^.*2.*$/gm)).toEqual(["## 2 章の扉"]);
  });

  test("test_タイトル枠の題にも_大きな番号を付ける（18-8）", async () => {
    // タイトル枠は字の大きさを書かない（型から継ぐ）ことが多い。28pt 以上なら章の番号
    const [slide] = await deckOf([
      [
        { text: ["1"], size: 6000 },
        { text: ["はじめに"], title: true },
      ],
    ]);
    expect(slide.title).toBe("1 はじめに");
  });

  test("test_題より小さい番号は_題に付けない（ページ番号のまま落とす。18-8）", async () => {
    const [slide] = await deckOf([
      [
        { text: ["章の扉"], size: 3200, y: 300000 },
        { text: ["7"], size: 1200, y: 6000000 },
      ],
    ]);
    expect(slide.title).toBe("章の扉");
    expect(slidesToMarkdown("資料", [slide])).not.toMatch(/7/);
  });

  test("test_大きな太字の番号も章の番号（カードの番号と取り違えない。18-8）", async () => {
    const [slide] = await deckOf([
      [
        {
          text: ["3"],
          size: 7200,
          bold: true,
          x: 0,
          y: 1000000,
          w: 900000,
          h: 900000,
        },
        {
          text: ["章の扉"],
          size: 3200,
          x: 1000000,
          y: 1000000,
          w: 900000,
          h: 900000,
        },
        {
          text: ["説明の文です。"],
          size: 1400,
          x: 1000000,
          y: 2000000,
          w: 900000,
          h: 900000,
        },
      ],
    ]);
    expect(slide.title).toBe("3 章の扉");
    expect(slidesToMarkdown("資料", [slide])).not.toContain("**3**");
  });

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
    // 章の扉の大きな「1」や、大きな字の長い文は題ではない。「1」は章の番号として
    // 題の頭に付く（18-8。以前は落としていた）
    const [slide] = await deckOf([
      [
        { text: ["1"], size: 4950, y: 1000000 },
        { text: ["あ".repeat(80)], size: 4000, y: 500000 },
        { text: ["ITで設備を制御する"], size: 3600, y: 1950000 },
      ],
    ]);
    expect(slide.title).toBe("1 ITで設備を制御する");
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

describe("番号だけの小さな枠（要望 2026-10-01）", () => {
  // カードや手順の頭に置いた「1」「2」の枠。1 つずつ箇条書きになって項目が増え、
  // 書き出すと「（続き）」の枚が増えていた。近くの枠の頭に付けて 1 項目にする
  const EMU = 360000;
  const ns =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  type Shape = {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    bold?: boolean;
    size?: number;
  };
  // 名前の拡張（a:extLst の a:ext）は、大きさの a:ext と同じ名前の要素。PowerPoint で
  // 保存した資料にはたいてい付いている（位置を取り違えないこと）
  const shape = (item: Shape) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"/></a:extLst></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${item.x}" y="${item.y}"/><a:ext cx="${item.w}" cy="${item.h}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr lang="ja-JP" sz="${item.size ?? 1400}"${item.bold ? ' b="1"' : ""}/><a:t>${item.text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  async function markdownOf(items: Shape[]) {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><p:sld ${ns}><p:cSld><p:spTree>${[
        { text: "題", x: 0, y: 0, w: 8 * EMU, h: EMU, size: 2400 },
        ...items,
      ]
        .map(shape)
        .join("")}</p:spTree></p:cSld></p:sld>`,
    );
    const slides = await readPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    return slidesToMarkdown("資料", slides);
  }

  test("test_カードの中の番号は_そのカードの頭に付ける（番号が先に並んでいても）", async () => {
    const md = await markdownOf([
      { text: "1", x: 1.1 * EMU, y: 2.1 * EMU, w: EMU, h: EMU, bold: true },
      { text: "2", x: 8.1 * EMU, y: 2.1 * EMU, w: EMU, h: EMU, bold: true },
      {
        text: "人手不足",
        x: EMU,
        y: 2 * EMU,
        w: 6 * EMU,
        h: 3 * EMU,
        bold: true,
      },
      {
        text: "チョコ停",
        x: 8 * EMU,
        y: 2 * EMU,
        w: 6 * EMU,
        h: 3 * EMU,
        bold: true,
      },
    ]);
    expect(md).toContain("- **1 人手不足**");
    expect(md).toContain("- **2 チョコ停**");
    expect(md).not.toMatch(/^- \*\*1\*\*$/m);
  });

  test("test_同じ行の右の見出しに付け_下の枠には付けない", async () => {
    const md = await markdownOf([
      { text: "1", x: EMU, y: 2 * EMU, w: EMU, h: EMU, bold: true },
      {
        text: "技術の壁",
        x: 2.3 * EMU,
        y: 2 * EMU,
        w: 4 * EMU,
        h: EMU,
        bold: true,
      },
      { text: "始められない", x: EMU, y: 3.2 * EMU, w: 3 * EMU, h: EMU },
    ]);
    expect(md).toContain("- **1 技術の壁**");
    expect(md).toContain("- 始められない");
  });

  test("test_ほぼ同じ近さなら_縦の中心が近い見出しに付ける", async () => {
    // 手順の「1」の右に見出しと説明が上下に並ぶ形。説明の方が 1 EMU だけ近くても見出しへ
    const md = await markdownOf([
      { text: "1", x: 850000, y: 1445000, w: 300000, h: 300000, bold: true },
      {
        text: "見出し",
        x: 1250000,
        y: 1370000,
        w: 3981610,
        h: 260000,
        bold: true,
      },
      { text: "例：説明", x: 1249999, y: 1640000, w: 3917139, h: 230000 },
    ]);
    expect(md).toContain("- **1 見出し**");
    expect(md).toContain("- 例：説明");
  });

  test("test_太字でない番号（ページ番号）は付けない", async () => {
    const md = await markdownOf([
      { text: "7", x: EMU, y: 2 * EMU, w: EMU, h: EMU },
      { text: "中身", x: 2.2 * EMU, y: 2 * EMU, w: 4 * EMU, h: EMU },
    ]);
    expect(md).toContain("- 中身");
    expect(md).not.toContain("7 中身");
  });

  test("test_近くに枠が無ければ番号は今までどおり残す", async () => {
    const md = await markdownOf([
      { text: "1", x: EMU, y: 2 * EMU, w: EMU, h: EMU, bold: true },
      { text: "遠い枠", x: 20 * EMU, y: 12 * EMU, w: 2 * EMU, h: EMU },
    ]);
    expect(md).toContain("- **1**");
  });
});

describe("中央に揃えた短い行だけの枠（カードのラベル。要望 2026-10-01）", () => {
  // 行ごとに箇条書きにすると、1 枚のカードが 2 項目になり、書き出しで「（続き）」が
  // 増えた。枠ごとに 1 項目にする。行は空白 1 つで繋ぐ（2 つの言葉を貼り合わせない）
  const label = (lines: string[], over: { centered?: boolean } = {}) =>
    slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: lines.map((line) =>
              para(line, { centered: over.centered ?? true }),
            ),
          },
        ],
        notes: "",
      },
    ]);

  test("test_ラベルの枠は_1_項目にまとめる", () => {
    const md = label(["技能継承断絶", "人手不足"]);
    expect(md).toContain("- 技能継承断絶 人手不足");
    expect(splitDeck(md).slides[0].blocks).toHaveLength(1);
  });

  test("test_中央に揃っていなければ今までどおり行ごと", () => {
    const md = label(["技能継承断絶", "人手不足"], { centered: false });
    expect(md).toContain("- 技能継承断絶\n- 人手不足");
  });

  test("test_文の行や長い行の枠はまとめない", () => {
    expect(label(["これは文です。", "次の文です。"])).toContain(
      "これは文です。\n\n次の文です。",
    );
    const long = "あ".repeat(40);
    expect(label([long, "短い"])).toContain(`- ${long}\n- 短い`);
  });

  test("test_1_行の枠は今までどおり", () => {
    expect(label(["技術"])).toContain("- 技術");
  });

  test("test_太字は行ごとに残す", () => {
    const md = slidesToMarkdown("資料", [
      {
        title: "A",
        shapes: [
          {
            kind: "text",
            paragraphs: [
              {
                runs: [run("帳票の", { bold: true })],
                level: 0,
                bulletNone: false,
                centered: true,
              },
              {
                runs: [run("大量の紙", { bold: true })],
                level: 0,
                bulletNone: false,
                centered: true,
              },
            ],
          },
        ],
        notes: "",
      },
    ]);
    expect(md).toContain("- **帳票の** **大量の紙**");
  });
});
