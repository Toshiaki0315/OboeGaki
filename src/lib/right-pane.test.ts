import { describe, expect, it } from "vitest";
import { restoreRightPane, RIGHT_PANE_KEY, togglePane } from "./right-pane";

describe("togglePane", () => {
  it("test_閉じているところから開く", () => {
    expect(togglePane("none", "outline")).toBe("outline");
    expect(togglePane("none", "assistant")).toBe("assistant");
  });

  it("test_同じものを押したら閉じる", () => {
    expect(togglePane("outline", "outline")).toBe("none");
    expect(togglePane("assistant", "assistant")).toBe("none");
  });

  it("test_もう片方を押したら入れ替わる（右のペインは常に1つ）", () => {
    // **同時に開くことはありえない形にする。** 真偽値 2 つで持って手で
    // 閉じ合っていた頃、片方が閉じ損ねてアウトラインが左下へ回り込んだ
    expect(togglePane("assistant", "outline")).toBe("outline");
    expect(togglePane("outline", "assistant")).toBe("assistant");
  });
});

describe("restoreRightPane", () => {
  it("test_前回アウトラインを開いていたら開いた状態で始まる", () => {
    expect(restoreRightPane({ getItem: () => "1" })).toBe("outline");
  });

  it("test_記憶がなければ閉じた状態", () => {
    expect(restoreRightPane({ getItem: () => null })).toBe("none");
  });

  it("test_読み出しが例外を投げても閉じた状態で始まる", () => {
    expect(
      restoreRightPane({
        getItem: () => {
          throw new Error("storage unavailable");
        },
      }),
    ).toBe("none");
  });

  it("test_覚えているのはアウトラインだけ", () => {
    // アシスタントは重い（モデルを起こす）ので、起動時に勝手に出さない
    expect(RIGHT_PANE_KEY).toBe("oboegaki.outline");
  });
});
