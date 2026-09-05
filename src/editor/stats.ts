// 文字数と行数（TASKS 3-10）。参照実装 core/stats.py の移植。
//
// **単語数は出さない。** 日本語には語の区切りが無く、参照実装では CJK を
// 1 文字 1 語として数えて `東京都渋谷区` が 6 語になった（ユーザーの指摘で
// 取りやめ）。本当に数えるには形態素解析が要り、ステータスバーの数字 1 つの
// ために依存を増やす価値はない。
//
// 数える対象は**マーカーを外した本文**（plain-copy と同じ判断: 装飾は
// 文章の一部ではない）。front matter も数えない。
//
// **呼んだときだけ数える**（ADR-0022 のアウトラインと同じ）。打鍵ごとに
// 全文を走査すると 16ms の予算を食う。

import type { EditorState } from "@codemirror/state";
import { plainTextOf } from "./plain-copy";
import { frontMatterRange } from "./frontmatter";

export type TextStats = {
  characters: number;
  lines: number;
};

/// 本文の分量を数える。改行は文字に数えない。
export function countText(text: string): TextStats {
  const withoutBreaks = text.replace(/\n/g, "");
  return {
    // **コードポイントで数える。** JS の length は UTF-16 単位なので、
    // 絵文字が 2 文字になる（人が見ている 1 文字と合わない）
    characters: [...withoutBreaks].length,
    lines: text.trim() ? text.replace(/\n+$/, "").split("\n").length : 0,
  };
}

/// 原稿用紙（400 字詰め）の枚数。1 枚に満たなければ null。
///
/// **日本語の書き手はこちらで測る**（ポメラの調べ 2026-09-06）。
/// 切り上げない — 「あと少しで 2 枚」が見えるほうが手が進む。
/// 1 枚未満のときに「0.2 枚」と言われても分からないので、出さない。
export function sheets(characters: number): string | null {
  if (characters < SHEET) return null;
  const count = Math.floor((characters / SHEET) * 10) / 10;
  return String(count);
}

/// 原稿用紙 1 枚の字数（20 字 × 20 行）。
const SHEET = 400;

/// エディタの今の内容を数える。
export function statsOf(state: EditorState): TextStats {
  const body = frontMatterRange(state.doc.toString())?.bodyStart ?? 0;
  return countText(plainTextOf(state, body, state.doc.length));
}
