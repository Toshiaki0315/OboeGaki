// SVG（Mermaid の図）を PNG にする前段。大きさの読み取りと、root への
// 明示的な幅・高さの付け方は純関数で確かめる（描くのは WebView だけ）。

import { describe, expect, test } from "vitest";
import { sizedSvg, svgSize } from "./svg-png";

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
