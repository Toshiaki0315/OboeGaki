// スパイク #1: `*` の flanking 緩和を Lezer の拡張 API だけで実現する。
//
// 参照実装（hitofude/core/inline_scanner.py）の規則:
//   - `*` は「開き = 直後が空白でない」「閉じ = 直前が空白でない」に緩める（R4）
//   - `_` は CommonMark 厳密のまま（snake_case を守る）→ 組み込みに任せる
//   - デリミタ列は長さ完全一致（1/2/3）でのみ対になる。4 個以上は対にしない
//
// 実現方法: 組み込みの "Emphasis" パーサより前（before）に割り込み、`*` の
// 連続をすべてこちらで消費する。Lezer 内部の強調サイズ処理（min-2 消費や
// rule-of-3）は非公開デリミタ型との同一性判定に紐付いていて使えないが、
// 「長さごとに別のデリミタ型」を割り当てれば、汎用の resolveMarkers が
// 参照実装と同じ「完全一致長 + 直近の開きを閉じる」ペアリングをしてくれる。
//
// 注意: 長さ 3（***強調斜体***）は StrongEmphasis 1 ノード（マーカー 3 文字）で
// 表す。参照実装の STRONG_EM と同型。製品実装で CM6 の標準的な入れ子
// （Strong の中に Em）に合わせたくなったら resolve 先を変えるだけでよい。

const delimForLength = [
  null,
  { resolve: "Emphasis", mark: "EmphasisMark" }, // *em*
  { resolve: "StrongEmphasis", mark: "EmphasisMark" }, // **strong**
  { resolve: "StrongEmphasis", mark: "EmphasisMark" }, // ***strong em***
];

const ASTERISK = 42;

export const relaxedAsterisk = {
  parseInline: [
    {
      name: "RelaxedAsteriskEmphasis",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== ASTERISK) return -1;
        let end = pos + 1;
        while (end < cx.end && cx.char(end) === ASTERISK) end++;
        const length = end - pos;
        // 参照実装は完全一致長でしか対にしないので、4 個以上はただの文字
        if (length > 3) return end;
        const before = pos > cx.offset ? cx.slice(pos - 1, pos) : "";
        const after = end < cx.end ? cx.slice(end, end + 1) : "";
        // ここが緩和の本体。CommonMark の句読点条件を外し、空白だけを見る
        const canOpen = after !== "" && !/\s/.test(after);
        const canClose = before !== "" && !/\s/.test(before);
        if (!canOpen && !canClose) return end; // 消費だけして装飾にしない
        return cx.addDelimiter(delimForLength[length], pos, end, canOpen, canClose);
      },
    },
  ],
};
