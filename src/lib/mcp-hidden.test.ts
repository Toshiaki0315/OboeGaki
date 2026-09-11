// 「Claude に渡さない」の判定（GUI の印）。`.mcp-ignore` の中身と突き合わせる。

import { describe, expect, it } from "vitest";
import { isHiddenFromMcp, relativeIn } from "./mcp-hidden";

describe("relativeIn", () => {
  it("test_保管フォルダの下を相対にする", () => {
    expect(relativeIn("/vault", "/vault/仕事/会議.md")).toBe("仕事/会議.md");
    expect(relativeIn("/vault", "仕事")).toBe("仕事");
    expect(relativeIn("/vault", "/vault")).toBe("");
  });
});

describe("isHiddenFromMcp", () => {
  const hidden = ["プライベート", "仕事/評価", "秘密のメモ.md"];

  it("test_名指しされていれば隠れている", () => {
    expect(isHiddenFromMcp(hidden, "プライベート")).toBe(true);
    expect(isHiddenFromMcp(hidden, "秘密のメモ.md")).toBe(true);
  });

  it("test_隠したフォルダの中も隠れている", () => {
    expect(isHiddenFromMcp(hidden, "プライベート/日記.md")).toBe(true);
    expect(isHiddenFromMcp(hidden, "仕事/評価/2026.md")).toBe(true);
  });

  it("test_前方一致では隠さない（プライベート2 は別物）", () => {
    expect(isHiddenFromMcp(hidden, "プライベート2/x.md")).toBe(false);
    expect(isHiddenFromMcp(hidden, "仕事/会議.md")).toBe(false);
  });

  it("test_空は隠さない（保管フォルダそのもの）", () => {
    expect(isHiddenFromMcp(hidden, "")).toBe(false);
  });
});
