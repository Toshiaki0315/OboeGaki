// 数式の検出と組版（TASKS 4-1 / ADR-0036）。
//
// LaTeX → MathML は Temml が行い、組むのは WebKit（macOS 13+ の MathML
// Core）。画面も HTML 書き出しも**同じ MathML 文字列**を使う。
//
// 誤検出の抑えは参照実装（ADR-0009）の 3 条件をそのまま持ち込む。`$` は
// 値段にも出てくるので、ここが緩いと**ふつうの文章が壊れる**:
//   1. 開きの直後・閉じの直前が空白のものは数式にしない
//   2. 数字が隣り合うもの（`100$`）は数式にしない
//   3. かな・漢字を含むものは数式にしない

import temml from "temml";

// 組んだ結果の覚え。装飾の再計算は同じ式を何度も見るので、組み直すと
// 数式の多いノートで打鍵 p95 が 16ms を割る（レビュー 2026-09-04 で実測）。
// 組めなかった式（null）も覚える — 壊れた式ほど何度も見るため
const rendered = new Map<string, string | null>();
const CACHE_LIMIT = 500;

/// LaTeX を MathML にする。**組めなければ null**（生の LaTeX のまま
/// 見せる。赤いエラーを本文に埋めると「直せない何か」が出る）。
export function renderMath(latex: string, display: boolean): string | null {
  const key = `${display ? "D" : "i"}:${latex}`;
  const known = rendered.get(key);
  if (known !== undefined) return known;
  let mathml: string | null;
  try {
    mathml = temml.renderToString(latex, {
      displayMode: display,
      throwOnError: true,
      // 画面と書き出しで同じ文字列を使うので、注釈は付けない
      // （元の LaTeX はソースに残っている）
      annotate: false,
    });
  } catch {
    mathml = null;
  }
  if (rendered.size >= CACHE_LIMIT) {
    // いちばん古い鍵から捨てる（Map は挿入順を保つ）
    const oldest = rendered.keys().next().value;
    if (oldest !== undefined) rendered.delete(oldest);
  }
  rendered.set(key, mathml);
  return mathml;
}
