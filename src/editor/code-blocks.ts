// コードブロックの言語別ハイライトとファイル名ラベル（TASKS 2-1）。
//
// 参照実装は Pygments + 自前の字句解析（core/code_tokens.py）だったが、
// CM6 では markdown の codeLanguages にフェンス内の入れ子パースを任せ、
// 色は HighlightStyle で付けるだけでよい。パレットは App.css の CSS 変数
// （ライト = Pygments friendly 系 / ダーク = github-dark 系）。
//
// ` ```python:aaa.py ` の `aaa.py` は画面にも出す（ADR-0008 —
// 書き出しにだけ出るのは片手落ち）。言語解決には `:` より前だけを使う。

import { HighlightStyle, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import { splitFenceInfo } from "../markdown/fence-info";

/// フェンスの情報文字列から言語を見つける（markdown の codeLanguages 用）。
export function resolveCodeLanguage(info: string): LanguageDescription | null {
  const { lang } = splitFenceInfo(info);
  if (!lang) return null;
  return (
    LanguageDescription.matchLanguageName(languages, lang, true) ??
    // `py` `rs` のような拡張子表記も許す（名前・別名に無ければ拡張子で引く）
    LanguageDescription.matchFilename(languages, `x.${lang}`)
  );
}

/// フェンス内のコードの配色。markdown 自体はこれらのタグを出さないので、
/// 入れ子パースの結果にだけ効く。実色は App.css の CSS 変数が持つ
/// （ライト / ダークをメディアクエリで切り替えるため）。
export const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-keyword)" },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--code-string)",
  },
  { tag: tags.comment, color: "var(--code-comment)", fontStyle: "italic" },
  {
    tag: [tags.number, tags.bool, tags.atom, tags.null],
    color: "var(--code-number)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--code-type)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--code-func)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--code-def)" },
  { tag: tags.propertyName, color: "var(--code-prop)" },
  { tag: tags.meta, color: "var(--code-comment)" },
]);
