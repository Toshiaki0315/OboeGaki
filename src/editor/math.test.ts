// 数式の検出と組版（TASKS 4-1 / ADR-0036）。
//
// 誤検出の条件は参照実装 ADR-0009 の 3 つをそのまま持ち込む。
// `$` は値段にも出てくるので、ここが緩いと**ふつうの文章が壊れる**。

import { describe, expect, test } from "vitest";
import { mathSpanAt, renderMath } from "./math";

/// 最初の `$` から測る（見つからなければ null）。
function span(text: string) {
  const start = text.indexOf("$");
  return start < 0 ? null : mathSpanAt(text, start);
}

describe("mathSpanAt", () => {
  test("インライン数式を拾う", () => {
    expect(span("式は $E = mc^2$ です")).toEqual({
      end: "式は $E = mc^2$".length,
      latex: "E = mc^2",
      display: false,
    });
  });

  test("`$$` はディスプレイ数式（`$` より先に見る）", () => {
    // あとに見ると `$$a$$` が `$` と `$a$` に割れて範囲がずれる
    expect(span("$$\\frac{a}{b}$$")).toEqual({
      end: 15,
      latex: "\\frac{a}{b}",
      display: true,
    });
  });

  test("開きの直後が空白なら数式ではない", () => {
    expect(span("$ x $")).toBeNull();
  });

  test("閉じの直前が空白なら数式ではない", () => {
    expect(span("$x $")).toBeNull();
  });

  test("数字が隣り合うものは数式ではない（値段）", () => {
    expect(span("100$ から")).toBeNull();
    expect(span("価格は $100 です")).toBeNull();
  });

  test("かな・漢字を含むものは数式ではない", () => {
    // 「価格は $100 と $200 です」の 1 つ目の閉じと 2 つ目の開きが組に
    // なって、`200です。定価100` が数式として組まれていた（実機で発覚）
    expect(span("$100 と $200 です")).toBeNull();
    expect(span("$日本語$")).toBeNull();
  });

  test("中身が空・閉じが無い・行をまたぐものは数式ではない", () => {
    expect(span("$$")).toBeNull();
    expect(span("$x")).toBeNull();
    expect(span("$x\ny$")).toBeNull();
  });

  test("同じ行に 2 つ書ける", () => {
    const text = "$a$ と $b$";
    const first = mathSpanAt(text, 0);
    expect(first).toEqual({ end: 3, latex: "a", display: false });
    const second = mathSpanAt(text, text.lastIndexOf("$b$"));
    expect(second?.latex).toBe("b");
  });
});

describe("renderMath", () => {
  test("MathML を返す", () => {
    const found = renderMath("E = mc^2", false);
    expect(found).toContain("<math");
    expect(found).toContain("</math>");
  });

  test("ディスプレイ数式は display 付き", () => {
    expect(renderMath("\\frac{a}{b}", true)).toContain('display="block"');
  });

  test("組めない式は null（生の LaTeX のまま見せる）", () => {
    // 赤いエラーを本文に埋めると「直せない何か」が出る。書いた人が
    // 直せる状態を保つ
    expect(renderMath("\\frac{a", false)).toBeNull();
    expect(renderMath("\\unknowncommand{x}", false)).toBeNull();
  });
});
