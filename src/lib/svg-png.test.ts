// SVG（Mermaid の図）を PNG にする前段。大きさの読み取りと、root への
// 明示的な幅・高さの付け方は純関数で確かめる（描くのは WebView だけ）。

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  rasterizeForDocx,
  rasterizeForPptx,
  rasterizeIfSvg,
  sizedSvg,
  svgFromDataUrl,
  svgNaturalSize,
  svgSize,
} from "./svg-png";

describe("svgSize", () => {
  test("test_viewBox から大きさを取る（Mermaid は width が 100% のことがある）", () => {
    expect(svgSize('<svg width="100%" viewBox="0 0 640 320"></svg>')).toEqual({
      width: 640,
      height: 320,
    });
  });
  test("test_viewBox が無ければ width と height", () => {
    expect(svgSize('<svg width="300px" height="150"></svg>')).toEqual({
      width: 300,
      height: 150,
    });
  });
  test("test_どちらも読めなければ既定", () => {
    expect(svgSize("<svg></svg>")).toEqual({ width: 800, height: 600 });
  });
});

describe("sizedSvg", () => {
  test("test_root に幅と高さを明示し_元の width と height は外す", () => {
    const out = sizedSvg(
      '<svg width="100%" viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      2,
    );
    expect(out.startsWith('<svg width="128" height="64" ')).toBe(true);
    expect(out).toContain('viewBox="0 0 64 32"');
    expect(out).not.toContain('width="100%"');
  });
});

// 本文に貼った SVG ファイル（要望 2026-09-09）。Rust は data URL で返す
// ので、中身を取り出して大きさを見る
describe("svgFromDataUrl", () => {
  test("test_base64 の data URL から SVG の文字列を取り出す（日本語も崩れない）", () => {
    const svg = '<svg viewBox="0 0 10 10"><title>図</title></svg>';
    const b64 = Buffer.from(svg, "utf8").toString("base64");
    expect(svgFromDataUrl(`data:image/svg+xml;base64,${b64}`)).toBe(svg);
  });
  test("test_percent-encoding の data URL も読む", () => {
    const svg = '<svg viewBox="0 0 10 10"/>';
    expect(
      svgFromDataUrl(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      ),
    ).toBe(svg);
  });
  test("test_SVG でなければ null", () => {
    expect(svgFromDataUrl("data:image/png;base64,AA==")).toBeNull();
    expect(svgFromDataUrl("attachments/a.svg")).toBeNull();
  });
});

describe("svgNaturalSize", () => {
  test("test_root に px の幅と高さがあればブラウザに任せる（null）", () => {
    expect(svgNaturalSize('<svg width="300" height="150"/>')).toBeNull();
    expect(svgNaturalSize('<svg width="300px" height="150px"/>')).toBeNull();
  });
  test("test_幅が無い・100% なら viewBox の大きさ（無いと <img> が 300×150 になる）", () => {
    expect(svgNaturalSize('<svg viewBox="0 0 640 320"/>')).toEqual({
      width: 640,
      height: 320,
    });
    expect(svgNaturalSize('<svg width="100%" viewBox="0 0 64 32"/>')).toEqual({
      width: 64,
      height: 32,
    });
  });
  test("test_viewBox も無ければ null", () => {
    expect(svgNaturalSize("<svg/>")).toBeNull();
  });
});

describe("rasterizeIfSvg", () => {
  test("test_SVG 以外はそのまま返す（描き直さない）", async () => {
    await expect(rasterizeIfSvg("data:image/png;base64,AA==")).resolves.toBe(
      "data:image/png;base64,AA==",
    );
    await expect(rasterizeIfSvg(null)).resolves.toBeNull();
  });
});

describe("rasterizeForDocx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /// canvas と Image を差し替える（node には無い。描くのは WebView だけ）。
  /// 描いた回数と、書き出した種類を覚える
  function fakeCanvas() {
    const drawn: string[] = [];
    const encoded: string[] = [];
    class FakeImage {
      naturalWidth = 3;
      naturalHeight = 4;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        drawn.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: (type: string) => {
          encoded.push(type);
          return `data:${type};base64,UPRIGHT`;
        },
      }),
    });
    return { drawn, encoded };
  }

  // SOI → APP1（Exif、Orientation = 6）→ EOI
  const rotated =
    "data:image/jpeg;base64," +
    btoa(
      String.fromCharCode(
        0xff,
        0xd8,
        0xff,
        0xe1,
        0,
        34,
        0x45,
        0x78,
        0x69,
        0x66,
        0,
        0,
        0x4d,
        0x4d,
        0,
        42,
        0,
        0,
        0,
        8,
        0,
        1,
        0x01,
        0x12,
        0,
        3,
        0,
        0,
        0,
        1,
        0,
        6,
        0,
        0,
        0,
        0,
        0,
        0,
        0xff,
        0xd9,
      ),
    );

  test("test_向きの印付きの_JPEG_は正しい向きに描き直し_JPEG_のまま返す（レビュー 2026-09-27）", async () => {
    const { drawn, encoded } = fakeCanvas();
    await expect(rasterizeForDocx(rotated)).resolves.toBe(
      "data:image/jpeg;base64,UPRIGHT",
    );
    expect(drawn).toEqual([rotated]);
    // 写真を PNG にすると何倍にも膨らむので JPEG で書き直す
    expect(encoded).toEqual(["image/jpeg"]);
  });

  test("test_PowerPoint_でも向きの印付きの_JPEG_は描き直す（レビュー 2026-09-28）", async () => {
    const { drawn, encoded } = fakeCanvas();
    await expect(rasterizeForPptx(rotated)).resolves.toBe(
      "data:image/jpeg;base64,UPRIGHT",
    );
    expect(drawn).toEqual([rotated]);
    expect(encoded).toEqual(["image/jpeg"]);
    // 印の無い絵は触らない（PowerPoint は WebP なども受けるので種類は変えない）
    const plain = "data:image/webp;base64,AA==";
    await expect(rasterizeForPptx(plain)).resolves.toBe(plain);
    await expect(rasterizeForPptx(null)).resolves.toBeNull();
    expect(drawn).toEqual([rotated]);
  });

  test("test_印の無い_JPEG_と_PNG_は描き直さない", async () => {
    const { drawn } = fakeCanvas();
    const plain = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9))}`;
    await expect(rasterizeForDocx(plain)).resolves.toBe(plain);
    await expect(rasterizeForDocx("data:image/png;base64,AA==")).resolves.toBe(
      "data:image/png;base64,AA==",
    );
    expect(drawn).toEqual([]);
  });
});
