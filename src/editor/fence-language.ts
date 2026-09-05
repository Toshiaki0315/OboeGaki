// コードの言語の補完（TASKS 6-3、要望 2026-09-05）。
//
// ` ```c ` まで打つと、`c` `cpp` `css` … と候補が出る（Qiita と同じ入口）。
//
// **候補は「実際に色が付く言語」だけ。** 色付けが見ているのと同じ
// `@codemirror/language-data` の表から作るので、選んだのに色が付かない、
// ということが起きない。

import {
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { languages } from "@codemirror/language-data";

export type LanguageOption = {
  /// 本文に入る綴り（`cpp`）。
  token: string;
  /// 画面に添える読める名前（`C++`）。
  name: string;
};

/// 打てる綴りと、その読める名前。名前そのものも別名も出す
/// （`c++` でも `cpp` でも辿り着ける）。
export const LANGUAGE_OPTIONS: LanguageOption[] = (() => {
  const out: LanguageOption[] = [];
  const seen = new Set<string>();
  for (const language of languages) {
    for (const token of [language.name.toLowerCase(), ...language.alias]) {
      // 空白入りの通称（`stylesheets (gss)` など）は打てないので外す
      if (!token || /\s/.test(token) || seen.has(token)) continue;
      seen.add(token);
      out.push({ token, name: language.name });
    }
  }
  return out;
})();

// **行頭のフェンスだけ**（字下げされた ``` はコード例）。`:` から後ろは
// ファイル名なので触らない（ADR-0008）
const FENCE_RE = /^(?:```|~~~)([^\s:`~]+)$/;

/// その位置で打ちかけている言語名。候補を出す場所でなければ null。
///
/// **1 文字も打っていないうちは出さない。** ` ``` ` だけで一覧が出ると、
/// ただのコードブロックを書きたいときに Enter が候補の決定に化ける。
export function fencePrefixAt(line: string, column: number): string | null {
  if (line.slice(column)) return null; // 行の続きがあるなら出さない
  const found = FENCE_RE.exec(line.slice(0, column));
  return found ? found[1] : null;
}

/// 前方一致で絞る。大文字小文字は区別しない。
export function matchLanguages(
  prefix: string,
  options: readonly LanguageOption[] = LANGUAGE_OPTIONS,
): LanguageOption[] {
  const lowered = prefix.toLowerCase();
  return options.filter((option) => option.token.startsWith(lowered));
}

/// フェンスの直後で言語名を打っている間だけ候補を出す補完ソース。
export function fenceLanguageCompletion(
  options: readonly LanguageOption[] = LANGUAGE_OPTIONS,
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.view?.composing) return null; // 変換中（T5）
    const line = context.state.doc.lineAt(context.pos);
    const prefix = fencePrefixAt(line.text, context.pos - line.from);
    if (prefix === null) return null;
    const found = matchLanguages(prefix, options);
    if (found.length === 0) return null;
    return {
      // **`` ``` `` は残して言語名だけ置き換える**
      from: context.pos - prefix.length,
      options: found.map((option) => ({
        label: option.token,
        detail: option.name,
        type: "keyword",
      })),
      validFor: /^[^\s:`~]*$/,
    };
  };
}
