// 取り込みを試す見本を作り直す（要望 2026-09-13）。`make samples` から呼ぶ。
//
// **見本は作り直せるようにしておく。** 中身を直したくなったとき、バイナリを
// 手で置き換えると「何がどう入っているか」が分からなくなる。ここが唯一の
// 出どころ（fixtures/ はスタック非依存の仕様資産という約束に沿う）。
//
// PDF だけは Core Graphics に描かせる（scripts/make-sample-pdf.swift）。
// Node には絵と文字を 1 枚に置ける PDF の道具が入っていない。

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PptxGenJS from "pptxgenjs";

const OUT = "fixtures/samples/読み込みの見本";
mkdirSync(OUT, { recursive: true });

// --------------------------------------------------------------- PNG / JPG

/// 素の PNG を組む（依存を増やさないため手で。24bit RGB・フィルタ無し）。
/// 文字も描きたいので、**点で字を打つ**小さなフォントを持つ
function png(width, height, draw) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = y * row + 1 + x * 3;
    raw[at] = r;
    raw[at + 1] = g;
    raw[at + 2] = b;
  };
  draw(set);
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const name = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, body])) >>> 0);
    return Buffer.concat([head, name, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/// 5x7 の点字フォント（OCR に読ませるので、字は大きく打つ）
const GLYPHS = {
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function text(set, message, x0, y0, scale, color) {
  let x = x0;
  for (const letter of message.toUpperCase()) {
    const glyph = GLYPHS[letter] ?? GLYPHS[" "];
    glyph.forEach((line, row) =>
      [...line].forEach((on, column) => {
        if (on !== "1") return;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++)
            set(x + column * scale + dx, y0 + row * scale + dy, color);
      }),
    );
    x += 6 * scale;
  }
}

const photo = png(480, 200, (set) => {
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 480; x++) set(x, y, [250, 250, 252]);
  // 枠
  for (let x = 0; x < 480; x++) {
    set(x, 0, [30, 39, 70]);
    set(x, 199, [30, 39, 70]);
  }
  for (let y = 0; y < 200; y++) {
    set(0, y, [30, 39, 70]);
    set(479, y, [30, 39, 70]);
  }
  text(set, "OBOEGAKI", 40, 40, 6, [30, 39, 70]);
  text(set, "TEST", 40, 120, 6, [192, 57, 43]);
});
writeFileSync(join(OUT, "写真.png"), photo);
console.log("写真.png");

// --------------------------------------------------------------------- SVG

writeFileSync(
  join(OUT, "図.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160">
  <rect x="0" y="0" width="320" height="160" fill="#f7f7fa" stroke="#1e2746" stroke-width="2"/>
  <circle cx="80" cy="80" r="40" fill="#1e2746"/>
  <rect x="150" y="40" width="120" height="80" rx="8" fill="#c0392b"/>
  <text x="160" y="140" font-family="Hiragino Sans, sans-serif" font-size="16" fill="#1e2746">SVG の見本</text>
</svg>
`,
  "utf8",
);
console.log("図.svg");

// --------------------------------------------------------------------- CSV

writeFileSync(
  join(OUT, "表.csv"),
  [
    "商品,数量,単価,備考",
    "鉛筆,12,80,",
    '"消しゴム, 白",3,120,"「まとめ買い」で割引"',
    "ノート,5,240,罫線 A4",
    "定規,1,350,ふぞろいの行 ->",
    "クリップ,100",
  ].join("\n") + "\n",
  "utf8",
);
console.log("表.csv");

// -------------------------------------------------------------------- DOCX

const docx = new Document({
  sections: [
    {
      children: [
        new Paragraph({ text: "Word の見本", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun("ふつうの段落と "),
            new TextRun({ text: "太字", bold: true }),
            new TextRun(" と "),
            new TextRun({ text: "斜体", italics: true }),
            new TextRun(" と "),
            new TextRun({ text: "打ち消し", strike: true }),
            new TextRun("。"),
          ],
        }),
        new Paragraph({ text: "見出し 2", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "箇条書き 1", bullet: { level: 0 } }),
        new Paragraph({ text: "箇条書き 2", bullet: { level: 1 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            ["項目", "内容"],
            ["文字", "日本語と English"],
            ["数値", "1,234"],
          ].map(
            (cells) =>
              new TableRow({
                children: cells.map(
                  (value) =>
                    new TableCell({ children: [new Paragraph(value)] }),
                ),
              }),
          ),
        }),
      ],
    },
  ],
});
writeFileSync(join(OUT, "見本.docx"), await Packer.toBuffer(docx));
console.log("見本.docx");

// -------------------------------------------------------------------- PPTX

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_16x9";
const title = pptx.addSlide();
title.addText("PowerPoint の見本", {
  x: 0.6,
  y: 2.2,
  w: 8,
  h: 1,
  fontSize: 36,
  bold: true,
});
title.addText("2026-09-13 / おぼえがきチーム", {
  x: 0.6,
  y: 3.3,
  w: 8,
  h: 0.5,
  fontSize: 18,
});

const bullets = pptx.addSlide();
bullets.addText("箇条書きの枚", {
  x: 0.6,
  y: 0.4,
  w: 8,
  h: 0.8,
  fontSize: 28,
  bold: true,
});
bullets.addText(
  [
    { text: "一つ目の項目", options: { bullet: true } },
    { text: "二つ目（入れ子）", options: { bullet: true, indentLevel: 1 } },
    { text: "三つ目", options: { bullet: true } },
  ],
  { x: 0.8, y: 1.4, w: 8, h: 3, fontSize: 20 },
);
bullets.addNotes("これは発表者ノートです。取り込むと引用として入ります。");

const picture = pptx.addSlide();
picture.addText("絵のある枚", {
  x: 0.6,
  y: 0.4,
  w: 8,
  h: 0.8,
  fontSize: 28,
  bold: true,
});
picture.addImage({
  data: `image/png;base64,${photo.toString("base64")}`,
  x: 0.8,
  y: 1.4,
  w: 4,
  h: 1.7,
});
picture.addText("絵の下の説明", { x: 0.8, y: 3.3, w: 6, h: 0.5, fontSize: 16 });

await pptx.writeFile({ fileName: join(OUT, "見本.pptx") });
console.log("見本.pptx");
