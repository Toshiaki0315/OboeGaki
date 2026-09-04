import { describe, expect, it } from "vitest";
import { anchorAbove, menuPosition } from "./context-menu";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 120 };

describe("anchorAbove", () => {
  const box = { left: 8, top: 760, height: 24 };

  it("test_押したものの真上に出す（高さを見積もらない）", () => {
    // **見積もりで置かない。** 実際が見積もりより短いと、押したものとの
    // 間に隙間が空く（実機報告 2026-09-04: 歯車から離れて出た）
    expect(anchorAbove(box, 230, viewport)).toEqual({
      left: 8,
      bottom: 800 - 760 + 6,
    });
  });

  it("test_右端で押されたら左へ寄せる", () => {
    expect(anchorAbove({ ...box, left: 950 }, 230, viewport).left).toBe(762);
  });

  it("test_画面より広いメニューは左端に貼り付ける", () => {
    expect(anchorAbove(box, 1200, viewport).left).toBe(8);
  });
});

describe("menuPosition", () => {
  it("test_収まるならクリックした場所に出す", () => {
    expect(menuPosition({ x: 300, y: 200 }, size, viewport)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("test_右端で押されたら左へ寄せる（窓の外へ出さない）", () => {
    expect(menuPosition({ x: 950, y: 200 }, size, viewport).x).toBe(792);
  });

  it("test_下端で押されたら上へ寄せる", () => {
    // **メニューの高さぶんだけ**上げる。決め打ちの数字で上げると、
    // 項目の少ないメニューが押した場所から遠くに出る
    expect(menuPosition({ x: 300, y: 780 }, size, viewport).y).toBe(672);
  });

  it("test_窓より大きいメニューは左上に貼り付ける（負の位置にしない）", () => {
    const huge = { width: 1200, height: 900 };
    expect(menuPosition({ x: 500, y: 500 }, huge, viewport)).toEqual({
      x: 8,
      y: 8,
    });
  });
});
