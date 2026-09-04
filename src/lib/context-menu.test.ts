import { describe, expect, it } from "vitest";
import { menuPosition } from "./context-menu";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 120 };

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
