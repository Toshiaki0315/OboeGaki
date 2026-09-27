// data URL の画像の中身と大きさ（Word 書き出しが使う。21-2）。
// Word（docx）は PNG / JPEG / GIF / BMP をそのまま受けるので、種類を見て通す。
// 以前は PNG しか受けず、写真（.jpg）を貼ったノートは Word で絵が黙って消えた
// （レビュー 2026-09-24）。WebP / AVIF / SVG は呼び手が PNG にしてから渡す

export type DocxImageType = "png" | "jpg" | "gif" | "bmp";

export type DecodedImage = { mime: string; bytes: Uint8Array };

/// `data:<mime>;base64,…` を種類と生のバイト列に。形が違えば null
export function decodeDataUrl(dataUrl: string): DecodedImage | null {
  const found = /^data:([^;,]+)(;[^,]*)?,/i.exec(dataUrl);
  if (!found) return null;
  const mime = found[1].toLowerCase();
  const payload = dataUrl.slice(found[0].length);
  if (!/;base64/i.test(found[2] ?? "")) return null;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/// Word に渡せる種類。渡せないもの（WebP / AVIF / SVG）は null
export function docxImageType(mime: string): DocxImageType | null {
  switch (mime.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    default:
      return null;
  }
}

/// 画像の大きさ（ピクセル）。ヘッダから読めなければ null
export function imageDimensions(
  type: DocxImageType,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type) {
    case "png":
      // IHDR: 8 バイトの印の後、長さ 4 + "IHDR" 4 → 幅 4・高さ 4（big endian）
      if (bytes.length < 24) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    case "gif":
      // "GIF87a"/"GIF89a" の後に論理画面の幅・高さ（little endian、2 バイトずつ）
      if (bytes.length < 10) return null;
      return {
        width: view.getUint16(6, true),
        height: view.getUint16(8, true),
      };
    case "bmp":
      // BITMAPFILEHEADER 14 バイトの後、DIB ヘッダの 4〜11 バイト目が幅・高さ
      // （little endian、符号付き。高さは上下逆さの印で負になることがある）
      if (bytes.length < 26) return null;
      // 古い BITMAPCOREHEADER（DIB ヘッダが 12 バイト）は幅・高さが 16 bit（21-5）
      if (view.getUint32(14, true) === 12) {
        return {
          width: view.getUint16(18, true),
          height: view.getUint16(20, true),
        };
      }
      return {
        width: Math.abs(view.getInt32(18, true)),
        height: Math.abs(view.getInt32(22, true)),
      };
    case "jpg":
      return jpegDimensions(bytes, view);
  }
}

/// data URL の絵の大きさ（ピクセル）。種類が分からない・読めなければ null
export function dataUrlDimensions(
  dataUrl: string,
): { width: number; height: number } | null {
  const decoded = decodeDataUrl(dataUrl);
  const type = decoded ? docxImageType(decoded.mime) : null;
  return decoded && type ? imageDimensions(type, decoded.bytes) : null;
}

/// JPEG はセグメントを辿って SOF（フレーム開始）を探す。SOF の中身は
/// 長さ 2・精度 1・高さ 2・幅 2（big endian）
function jpegDimensions(
  bytes: Uint8Array,
  view: DataView,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++; // 詰め物の 0xFF
      continue;
    }
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG（拡張）
      marker !== 0xcc; // DAC
    if (isSof) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS より先に SOF が無い
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/// JPEG の向きの印（EXIF の Orientation。1〜8）。無い・読めなければ 1（そのまま）。
/// 縦に撮った写真は画素を横倒しのまま置いて「回して見せる」印を付けることが
/// 多い。画面（WebKit）は印に従うが、Word は印を読まずに画素のまま置くので
/// 横倒しになる（レビュー 2026-09-27）
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++; // 詰め物の 0xFF
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return 1; // 絵の本体より先に無かった
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return 1;
    if (marker === 0xe1) {
      const found = exifOrientation(view, offset + 4, length - 2);
      if (found !== null) return found;
    }
    offset += 2 + length;
  }
  return 1;
}

/// APP1 の中身（`Exif\0\0` + TIFF）から IFD0 の Orientation を探す
function exifOrientation(
  view: DataView,
  start: number,
  length: number,
): number | null {
  const end = start + length;
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
  if (length < header.length + 8) return null;
  if (header.some((byte, i) => view.getUint8(start + i) !== byte)) return null;
  const tiff = start + header.length;
  const order = view.getUint16(tiff);
  if (order !== 0x4d4d && order !== 0x4949) return null;
  const little = order === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/// Word に渡す前に**画素を正しい向きに描き直す**必要があるか（向きの印が
/// 1 以外の JPEG の data URL）。描き直しは呼び手（svg-png の rasterizeForDocx）
export function needsUpright(dataUrl: string): boolean {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || docxImageType(decoded.mime) !== "jpg") return false;
  return jpegOrientation(decoded.bytes) !== 1;
}
