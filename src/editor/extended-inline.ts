// 取り消し線 `~~` とハイライト `::`（hitofude 独自記法）。
//
// 参照実装（inline_scanner.py の _DELIMITER_PASSES）の規則:
//   - どちらも長さ 2 の完全一致でだけ対になる（`~~~` は取り消しにしない）
//   - flanking は relaxedAsterisk と同じ緩和（開き = 直後が空白でない /
//     閉じ = 直前が空白でない）
//   - `::` は ASCII の単語に食い込んでいるときはマーカーにしない。
//     `std::vector::size` の `::` は識別子の一部（日本語は ASCII 単語
//     文字ではないので `これは::目立つ::です` には影響しない）
//
// GFM の Strikethrough 拡張は厳密 flanking なので使わず、同名のノードを
// 自前で定義する（ハイライトは対応するものが無いので Tag ごと新設）。

import type {
  DelimiterType,
  InlineContext,
  MarkdownConfig,
} from "@lezer/markdown";
import { Tag, tags } from "@lezer/highlight";

/// ハイライト（`::目立つ::`）のスタイル付けに使う専用タグ。
export const highlightTag = Tag.define();

const StrikeDelim: DelimiterType = {
  resolve: "Strikethrough",
  mark: "StrikethroughMark",
};
const HighlightDelim: DelimiterType = {
  resolve: "Highlight",
  mark: "HighlightMark",
};

const TILDE = 126; // ~
const COLON = 58; // :

const ASCII_WORD = /[A-Za-z0-9_]/;

function asciiWordAt(cx: InlineContext, pos: number): boolean {
  if (pos < cx.offset || pos >= cx.end) return false;
  return ASCII_WORD.test(cx.slice(pos, pos + 1));
}

/// 長さ 2 完全一致のデリミタを、緩和 flanking で登録する共通部。
function parsePair(
  cx: InlineContext,
  pos: number,
  code: number,
  delim: DelimiterType,
): number {
  let end = pos + 1;
  while (end < cx.end && cx.char(end) === code) end++;
  // 参照実装は完全一致長でしか対にしないので、2 以外はただの文字
  if (end - pos !== 2) return end;
  const before = pos > cx.offset ? cx.slice(pos - 1, pos) : "";
  const after = end < cx.end ? cx.slice(end, end + 1) : "";
  const canOpen = after !== "" && !/\s/.test(after);
  const canClose = before !== "" && !/\s/.test(before);
  if (!canOpen && !canClose) return end;
  return cx.addDelimiter(delim, pos, end, canOpen, canClose);
}

export const extendedInline: MarkdownConfig = {
  defineNodes: [
    {
      name: "Strikethrough",
      style: { "Strikethrough/...": tags.strikethrough },
    },
    { name: "StrikethroughMark", style: tags.processingInstruction },
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "RelaxedStrikethrough",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== TILDE) return -1;
        return parsePair(cx, pos, TILDE, StrikeDelim);
      },
    },
    {
      name: "HighlightInline",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== COLON) return -1;
        let end = pos + 1;
        while (end < cx.end && cx.char(end) === COLON) end++;
        // 両側とも ASCII 単語の中なら識別子の一部で確定（std::vector）
        if (asciiWordAt(cx, pos - 1) && asciiWordAt(cx, end)) return end;
        if (end - pos !== 2) return end;
        return parsePair(cx, pos, COLON, HighlightDelim);
      },
    },
  ],
};
