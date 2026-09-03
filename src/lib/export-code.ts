// 書き出しのコード色分け（TASKS 4-4 / ADR-0008）。
//
// **画面と同じ字句解析を使う。** 参照実装は Pygments（Python）だったが、
// こちらは CM6 が使う Lezer のパーサをそのまま呼ぶ。色分けの規則が
// 2 つあると、画面では色が付くのに書き出しでは付かない（またはその逆）
// という食い違いが出る。
//
// **色はクラスで出し、実色は書き出した HTML の CSS 変数が持つ。**
// スタイルシートも JavaScript も外から読まない（ADR-0007）ので、
// 1 枚のファイルとして完結したまま、読む人の明暗にも合う。

import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";
import { resolveCodeLanguage } from "../editor/code-blocks";

/// 画面の配色（editor/code-blocks.ts の codeHighlight）と**同じ組**。
/// あちらは CSS 変数を直に指定し、こちらはクラス名にする（書き出した
/// HTML 側で同じ変数に繋ぐ）。
const exportHighlighter = tagHighlighter([
  { tag: tags.keyword, class: "tok-keyword" },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    class: "tok-string",
  },
  { tag: tags.comment, class: "tok-comment" },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], class: "tok-number" },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "tok-type" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-func",
  },
  { tag: tags.definition(tags.variableName), class: "tok-def" },
  { tag: tags.propertyName, class: "tok-prop" },
  { tag: tags.meta, class: "tok-comment" },
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/// コードを色分けした HTML にする。**知らない言語は null**
/// （付けられないより、素で出るほうがよい）。
///
/// パーサの読み込みは非同期なので、書き出しの前に済ませておく
/// （図 = ADR-0037 と同じ手口）。
export async function highlightCodeHtml(
  code: string,
  info: string,
): Promise<string | null> {
  const description = resolveCodeLanguage(info);
  if (!description) return null;
  let support;
  try {
    support = description.support ?? (await description.load());
  } catch {
    return null; // 読み込めない言語で書き出しごと止めない
  }
  const tree = support.language.parser.parse(code);
  let html = "";
  highlightCode(
    code,
    tree,
    exportHighlighter,
    (text, classes) => {
      html += classes
        ? `<span class="${classes}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    },
    () => {
      html += "\n";
    },
  );
  return html;
}
