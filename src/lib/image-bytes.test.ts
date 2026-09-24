// data URL の画像の種類と大きさ（Word 書き出し。21-2）。ヘッダだけの
// 最小のバイト列で、PNG / JPEG / GIF / BMP の読み取りと、渡せない種類の判定を見る

import { describe, expect, test } from "vitest";
import { decodeDataUrl, docxImageType, imageDimensions } from "./image-bytes";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("image-bytes", () => {
  test("test_data_URL_を種類とバイト列に分ける_形が違えば_null", () => {
    const decoded = decodeDataUrl(`data:image/jpeg;base64,${b64([1, 2, 3])}`);
    expect(decoded?.mime).toBe("image/jpeg");
    expect(Array.from(decoded?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(decodeDataUrl("data:image/png,notbase64")).toBeNull();
    expect(decodeDataUrl("https://x/a.png")).toBeNull();
    expect(decodeDataUrl("data:image/png;base64,%%%")).toBeNull();
  });

  test("test_Word_に渡せる種類は_PNG_JPEG_GIF_BMP_だけ", () => {
    expect(docxImageType("image/png")).toBe("png");
    expect(docxImageType("image/jpeg")).toBe("jpg");
    expect(docxImageType("image/gif")).toBe("gif");
    expect(docxImageType("image/bmp")).toBe("bmp");
    expect(docxImageType("image/webp")).toBeNull();
    expect(docxImageType("image/svg+xml")).toBeNull();
  });

  test("test_PNG_の大きさは_IHDR_から", () => {
    const png = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0,
    ];
    expect(imageDimensions("png", new Uint8Array(png))).toEqual({
      width: 3,
      height: 2,
    });
  });

  test("test_JPEG_の大きさは_APP0_を飛ばして_SOF_から", () => {
    const jpeg = [
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0,
      4,
      0x4a,
      0x46, // APP0（長さ 4）
      0xff,
      0xc0,
      0,
      17,
      8,
      0,
      2,
      0,
      3,
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1, // SOF0: 高さ 2・幅 3
      0xff,
      0xd9, // EOI
    ];
    expect(imageDimensions("jpg", new Uint8Array(jpeg))).toEqual({
      width: 3,
      height: 2,
    });
    // SOF より先に終わる（壊れている）なら null
    expect(
      imageDimensions("jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeNull();
  });

  test("test_GIF_と_BMP_の大きさは_little_endian", () => {
    const gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 2, 0, 0, 0, 0];
    expect(imageDimensions("gif", new Uint8Array(gif))).toEqual({
      width: 3,
      height: 2,
    });
    const bmp = new Uint8Array(26);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    new DataView(bmp.buffer).setInt32(18, 3, true);
    new DataView(bmp.buffer).setInt32(22, -2, true); // 上下逆さの印
    expect(imageDimensions("bmp", bmp)).toEqual({ width: 3, height: 2 });
  });
});
