// `*` の flanking 緩和(hitofude R4 相当)。スパイク #1 の成果の TS 移植。
//
// 参照実装（hitofude/core/inline_scanner.py)の規則:
//   - `*` は「開き = 直後が空白でない」「閉じ = 直前が空白でない」に緩める
//   - `_` は CommonMark 厳密のまま（snake_case を守る）→ 組み込みに任せる
//   - デリミタ列は長さ完全一致（1/2/3）でのみ対になる。4 個以上は対にしない
//
// Lezer 内部の強調サイズ処理は非公開デリミタ型との同一性判定に紐付いていて
// 再利用できないが、長さごとに別のデリミタ型を割り当てれば、汎用の
// ペアリングが「完全一致長 + 直近の開きを閉じる」= 参照実装と同じ結果を出す。
// 検証: spikes/01-flanking/（参照実装オラクルと fixtures 段落 113/113 一致）

import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

const delimForLength: readonly (DelimiterType | null)[] = [
  null,
  { resolve: "Emphasis", mark: "EmphasisMark" }, // *em*
  { resolve: "StrongEmphasis", mark: "EmphasisMark" }, // **strong**
  { resolve: "StrongEmphasis", mark: "EmphasisMark" }, // ***strong em***
];

const ASTERISK = 42;

export const relaxedAsterisk: MarkdownConfig = {
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
        return cx.addDelimiter(delimForLength[length]!, pos, end, canOpen, canClose);
      },
    },
  ],
};
