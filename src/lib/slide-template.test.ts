// テンプレート .pptx の配色と書体を借りる（TASKS 5-6 / ADR-0045 案 A）。
//
// **テンプレートの中身は信じない。** 人が選ぶファイルなので、壊れていたり
// PowerPoint 以外の zip だったりする。読めなければ既定のまま出す。

import { describe, expect, it } from "vitest";
import { applyThemeParts, themeParts } from "./slide-template";

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="x" name="社内"><a:themeElements>
<a:clrScheme name="社内"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:accent1><a:srgbClr val="C8102E"/></a:accent1></a:clrScheme>
<a:fontScheme name="社内"><a:majorFont><a:latin typeface="Meiryo"/></a:majorFont><a:minorFont><a:latin typeface="Meiryo"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="社内"/></a:themeElements></a:theme>`;

describe("themeParts", () => {
  it("test_配色と書体を取り出す", () => {
    const parts = themeParts(THEME);
    expect(parts?.colors).toContain('val="C8102E"');
    expect(parts?.fonts).toContain("Meiryo");
  });

  it("test_配色か書体が無ければ借りない", () => {
    // 片方だけ入れ替えると、色と字が別のテンプレート由来になって混ざる
    expect(themeParts("<a:theme><a:clrScheme/></a:theme>")).toBeNull();
    expect(themeParts("")).toBeNull();
  });
});

describe("applyThemeParts", () => {
  const ours = `<a:theme><a:themeElements><a:clrScheme name="Office"><a:dk1/></a:clrScheme><a:fontScheme name="Office"><a:majorFont/></a:fontScheme><a:fmtScheme/></a:themeElements></a:theme>`;

  it("test_こちらの配色と書体を差し替える", () => {
    const parts = themeParts(THEME)!;
    const applied = applyThemeParts(ours, parts);
    expect(applied).toContain('val="C8102E"');
    expect(applied).toContain("Meiryo");
    expect(applied).not.toContain('name="Office"');
    // 図形の見た目（fmtScheme）はこちらのまま（テンプレートの塗りは借りない）
    expect(applied).toContain("<a:fmtScheme/>");
  });

  it("test_差し替えられなければ元のまま返す", () => {
    expect(applyThemeParts("<a:theme/>", themeParts(THEME)!)).toBe(
      "<a:theme/>",
    );
  });
});
