import { describe, expect, it } from "vitest";
import {
  referenceLives,
  restoreRightPane,
  RIGHT_PANE_KEY,
  togglePane,
} from "./right-pane";

describe("togglePane", () => {
  it("test_閉じているところから開く", () => {
    expect(togglePane("none", "outline")).toBe("outline");
    expect(togglePane("none", "assistant")).toBe("assistant");
  });

  it("test_同じものを押したら閉じる", () => {
    expect(togglePane("outline", "outline")).toBe("none");
    expect(togglePane("assistant", "assistant")).toBe("none");
  });

  it("test_横に開いたノートも同じ枠に入る（U-1）", () => {
    // 参照ペインも右の 1 枠。アウトラインやアシスタントと同時には出ない
    expect(togglePane("outline", "reference")).toBe("reference");
    expect(togglePane("reference", "reference")).toBe("none");
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

describe("referenceLives", () => {
  const paths = ["/v/a.md", "/v/仕事/b.md"];

  it("test_在るノートは出し続ける", () => {
    expect(referenceLives("/v/a.md", paths)).toBe(true);
  });

  it("test_消えたノートは畳む（もう無いものを読ませ続けない）", () => {
    // 直したつもりの内容を読み違える。読むだけのペインなので黙って畳む
    expect(referenceLives("/v/消えた.md", paths)).toBe(false);
  });

  it("test_出していなければ何もしない", () => {
    expect(referenceLives(null, paths)).toBe(false);
  });
});
