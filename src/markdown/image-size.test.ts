// 画像の大きさ指定（TASKS 6-8、要望 2026-09-06）。

import { describe, expect, test } from "vitest";
import { clampImageWidth, splitImageAlt, withImageWidth } from "./image-size";

describe("splitImageAlt", () => {
  test("test_説明のうしろの数を幅として読む", () => {
    expect(splitImageAlt("犬|300")).toEqual({ alt: "犬", width: 300 });
  });

  test("test_縦横を両方書ける", () => {
    expect(splitImageAlt("犬|300x200")).toEqual({
      alt: "犬",
      width: 300,
      height: 200,
    });
  });

  test("test_説明が無くても効く", () => {
    expect(splitImageAlt("|300")).toEqual({ alt: "", width: 300 });
  });

  test("test_数でなければ説明のまま（縦棒は書ける）", () => {
    // `A|B` のような説明を大きさと取り違えない
    expect(splitImageAlt("表 A|B")).toEqual({ alt: "表 A|B" });
    expect(splitImageAlt("犬|おおきめ")).toEqual({ alt: "犬|おおきめ" });
  });

  test("test_大きさの指定が無ければそのまま", () => {
    expect(splitImageAlt("犬")).toEqual({ alt: "犬" });
    expect(splitImageAlt("")).toEqual({ alt: "" });
  });

  test("test_見るのは最後の縦棒だけ", () => {
    expect(splitImageAlt("A|B|300")).toEqual({ alt: "A|B", width: 300 });
  });

  test("test_0 や桁あふれは大きさにしない", () => {
    // 0 を渡すと消える。桁あふれは書き間違いとみなして素の大きさで出す
    expect(splitImageAlt("犬|0")).toEqual({ alt: "犬|0" });
    expect(splitImageAlt("犬|99999")).toEqual({ alt: "犬|99999" });
  });
});

describe("withImageWidth（掴んで変えた幅を本文へ書き戻す。6-8b）", () => {
  test("test_幅を書き換える", () => {
    expect(withImageWidth("![犬|300](a.png)", 420)).toBe("![犬|420](a.png)");
  });

  test("test_無ければ足す_説明が空でも", () => {
    expect(withImageWidth("![犬](a.png)", 420)).toBe("![犬|420](a.png)");
    expect(withImageWidth("![](a.png)", 420)).toBe("![|420](a.png)");
  });

  test("test_縦横が書いてあっても幅だけにする（形なりに縮む）", () => {
    expect(withImageWidth("![犬|300x200](a.png)", 420)).toBe(
      "![犬|420](a.png)",
    );
  });

  test("test_null なら大きさの指定を外す", () => {
    expect(withImageWidth("![犬|300](a.png)", null)).toBe("![犬](a.png)");
    expect(withImageWidth("![犬](a.png)", null)).toBe("![犬](a.png)");
  });

  test("test_大きさでない縦棒つきの説明は残す", () => {
    expect(withImageWidth("![表 A|B](a.png)", 420)).toBe(
      "![表 A|B|420](a.png)",
    );
  });

  test("test_字下げと題名は触らない", () => {
    expect(withImageWidth('  ![犬](a.png "題")', 200)).toBe(
      '  ![犬|200](a.png "題")',
    );
  });

  test("test_画像でなければそのまま", () => {
    expect(withImageWidth("本文", 200)).toBe("本文");
  });
});

describe("clampImageWidth", () => {
  test("test_小さすぎず大きすぎず_整数", () => {
    expect(clampImageWidth(10)).toBe(32);
    expect(clampImageWidth(300.6)).toBe(301);
    expect(clampImageWidth(99999)).toBe(10000);
  });
});
