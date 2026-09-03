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
/// `#タグ`（ピル表示）のスタイル付けに使う専用タグ。
export const hashtagTag = Tag.define();
/// ノートリンク `[[名前]]` のスタイル付けに使う専用タグ。
export const wikiLinkTag = Tag.define();
/// 脚注参照 `[^1]` のスタイル付けに使う専用タグ（B-3。リンクと同系色）。
export const footnoteTag = Tag.define();

const StrikeDelim: DelimiterType = {
  resolve: "Strikethrough",
  mark: "StrikethroughMark",
};
const HighlightDelim: DelimiterType = {
  resolve: "Highlight",
  mark: "HighlightMark",
};

const TILDE = 126; // ~
const CARET = 94; // ^
const H_LOWER = 104; // h
const COLON = 58; // :
const HASH = 35; // #
const BRACKET = 91; // [
const CLOSE_BRACKET = 93; // ]
const PIPE = 124; // |

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
    { name: "Hashtag", style: hashtagTag },
    { name: "FootnoteRef", style: footnoteTag },
    { name: "BareURL", style: tags.link },
    { name: "WikiLink", style: { "WikiLink/...": wikiLinkTag } },
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      // `#タグ`（参照実装 core/tags.py の TAG_RE）。直前が空白か行頭の
      // ときだけ。名前は空白と `#` 以外の連続。`#` 自体は隠さない（§6.4）
      name: "Hashtag",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        if (pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos))) return -1;
        let end = pos + 1;
        while (end < cx.end) {
          const code = cx.char(end);
          if (code === HASH || /\s/.test(cx.slice(end, end + 1))) break;
          end++;
        }
        if (end === pos + 1) return -1; // 名前が無い
        return cx.addElement(cx.elt("Hashtag", pos, end));
      },
    },
    {
      // ノートリンク `[[名前]]`（E-6 / ADR-0011）。ふつうのリンクより先に
      // 見る（あとに回すと `[[a]](b)` の `[a]` が先にリンク化して範囲が
      // ずれる）。`|` を含むものと空名は拾わない。名前の中は解釈しない
      // （`[[a_b_c]]` の `_` は名前の一部）
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== BRACKET || cx.char(pos + 1) !== BRACKET) return -1;
        let end = pos + 2;
        while (end < cx.end && cx.char(end) !== CLOSE_BRACKET) {
          const code = cx.char(end);
          if (code === BRACKET || code === PIPE) return -1;
          end++;
        }
        if (end + 1 >= cx.end && cx.char(end + 1) !== CLOSE_BRACKET) return -1;
        if (cx.char(end + 1) !== CLOSE_BRACKET) return -1;
        if (!cx.slice(pos + 2, end).trim()) return -1; // 名前が無い
        const close = end + 2;
        return cx.addElement(
          cx.elt("WikiLink", pos, close, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkMark", close - 2, close),
          ]),
        );
      },
    },
    {
      // 脚注参照 `[^label]`（B-3、参照実装 _FOOTNOTE_RE）。ラベルは
      // 空白と角括弧以外の 1 文字以上。ふつうのリンクより先に見る
      name: "FootnoteRef",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== BRACKET || cx.char(pos + 1) !== CARET) return -1;
        let end = pos + 2;
        while (end < cx.end && cx.char(end) !== CLOSE_BRACKET) {
          const ch = cx.slice(end, end + 1);
          if (ch === "[" || /\s/.test(ch)) return -1;
          end++;
        }
        if (end >= cx.end || end === pos + 2) return -1; // 閉じ無し・空ラベル
        return cx.addElement(cx.elt("FootnoteRef", pos, end + 1));
      },
    },
    {
      // 裸 URL（参照実装 _BARE_URL_RE）。https?:// で始まり、空白・
      // <>()[]・引用符・日本語の句読点で止まる。`(...)` の丸括弧グループは
      // URL の一部として拾う（Wikipedia の `犬_(動物)` など）。
      // 直前が単語文字か `/` なら反応しない（xhttps:// はただの語）
      name: "BareURL",
      parse(cx, next, pos) {
        if (next !== H_LOWER) return -1;
        const head = cx.slice(pos, Math.min(cx.end, pos + 8));
        if (!/^https?:\/\//.test(head)) return -1;
        if (pos > cx.offset && /[\w/]/.test(cx.slice(pos - 1, pos))) return -1;
        // 参照実装の止め文字（\s <>()[] "' 、。）に全角の括弧類を足した。
        // 「（URL）」の形は日本語で頻出で、）を含めると必ず切れたリンクになる
        const stop = /[\s<>()\[\]"'、。（）「」]/;
        let end = pos + (head.startsWith("https") ? 8 : 7);
        let advanced = false;
        while (end < cx.end) {
          const ch = cx.slice(end, end + 1);
          if (ch === "(") {
            // 丸括弧グループ: 空白と括弧を含まない中身 + 閉じ括弧
            let probe = end + 1;
            while (
              probe < cx.end &&
              !/[\s()]/.test(cx.slice(probe, probe + 1))
            ) {
              probe++;
            }
            if (probe < cx.end && cx.char(probe) === 41) {
              end = probe + 1;
              advanced = true;
              continue;
            }
            break;
          }
          if (stop.test(ch)) break;
          end++;
          advanced = true;
        }
        if (!advanced) return -1; // `https://` だけでは URL ではない
        return cx.addElement(cx.elt("BareURL", pos, end));
      },
    },
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
