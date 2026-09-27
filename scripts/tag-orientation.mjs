// JPEG の向きの印（EXIF の Orientation）を書き換える。`make samples` から呼ぶ。
//
//   node scripts/tag-orientation.mjs <file.jpg> <1〜8>
//
// 縦に撮った写真の形（画素は横倒し + 「回して見せる」印）を見本に作るため
// （レビュー 2026-09-27: Word は印を読まずに画素のまま置く）。sips は回した
// 画素に Orientation = 1 の Exif を付けるので、その値を書き換える。Exif が
// 無ければ APP0（JFIF）の後ろに差し込む。依存を増やさないため手で組む

import { readFileSync, writeFileSync } from "node:fs";

const [file, raw] = process.argv.slice(2);
const value = Number(raw);
if (!file || !Number.isInteger(value) || value < 1 || value > 8) {
  console.error("使い方: node scripts/tag-orientation.mjs <file.jpg> <1〜8>");
  process.exit(1);
}

const bytes = readFileSync(file);
if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
  console.error(`JPEG ではありません: ${file}`);
  process.exit(1);
}

/// 既にある Orientation の値の位置（と端の向き）。無ければ null
function findOrientation() {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1];
    if (bytes[offset] !== 0xff || marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset + 2);
    const start = offset + 4;
    if (
      marker === 0xe1 &&
      bytes.toString("latin1", start, start + 6) === "Exif\0\0"
    ) {
      const tiff = start + 6;
      const little = bytes.toString("latin1", tiff, tiff + 2) === "II";
      const u16 = (at) =>
        little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
      const u32 = (at) =>
        little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
      const ifd = tiff + u32(tiff + 4);
      for (let i = 0; i < u16(ifd); i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return { at: entry + 8, little };
      }
    }
    offset += 2 + length;
  }
  return null;
}

/// SOI（と APP0）の後ろに差し込む、Orientation だけの Exif（大きい端）
function exifSegment() {
  // prettier-ignore
  const tiff = Buffer.from([
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // 頭と IFD0 の位置
    0, 1, // 項目の数
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, // Orientation（SHORT）
    0, 0, 0, 0, // 次の IFD は無い
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

const found = findOrientation();
if (found) {
  if (found.little) bytes.writeUInt16LE(value, found.at);
  else bytes.writeUInt16BE(value, found.at);
  writeFileSync(file, bytes);
} else {
  const afterApp0 = bytes[3] === 0xe0 ? 4 + bytes.readUInt16BE(4) : 2;
  writeFileSync(
    file,
    Buffer.concat([
      bytes.subarray(0, afterApp0),
      exifSegment(),
      bytes.subarray(afterApp0),
    ]),
  );
}
