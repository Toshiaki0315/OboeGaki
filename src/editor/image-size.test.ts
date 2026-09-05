// 画像の大きさ指定（TASKS 6-8、要望 2026-09-06）。

import { describe, expect, test } from "vitest";
import { splitImageAlt } from "./image-size";

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
