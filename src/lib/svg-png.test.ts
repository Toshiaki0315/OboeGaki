// SVG（Mermaid の図）を PNG にする前段。大きさの読み取りと、root への
// 明示的な幅・高さの付け方は純関数で確かめる（描くのは WebView だけ）。

import { describe, expect, test } from "vitest";
import {
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
