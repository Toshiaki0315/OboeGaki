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

// 属性値にも置くので `"` `'` まで落とす（`alt` や `class` を突き破らせない）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/// PowerPoint の run（TASKS 12-12）。`cls` は HTML と同じ字句の種類、
/// `breakLine` はその run のあとで行を折る印（改行は文字として持たない —
/// pptxgenjs は run の breakLine で段落を切る）
export type CodeRun = { text: string; cls: string | null; breakLine: boolean };

/// 字句の種類 → 色（`RRGGBB`）。**明るい地で読める組**。PowerPoint の
/// コードの枠は薄い地（bg2）なので、書き出し HTML の暗い地の組は使えない。
/// GitHub の light に近い並び
export const CODE_RUN_COLORS: Record<string, string> = {
  "tok-keyword": "CF222E",
  "tok-string": "0A3069",
  "tok-comment": "6E7781",
  "tok-number": "0550AE",
  "tok-type": "953800",
  "tok-func": "8250DF",
  "tok-def": "8250DF",
  "tok-prop": "116329",
};

/// コードを字句ごとの run にする。HTML（highlightCodeHtml）と**同じ切り方**。
/// 知らない言語は null
export async function highlightCodeRuns(
  code: string,
  info: string,
): Promise<CodeRun[] | null> {
  const description = resolveCodeLanguage(info);
  if (!description) return null;
  let support;
  try {
    support = description.support ?? (await description.load());
  } catch {
    return null;
  }
  const tree = support.language.parser.parse(code);
  const runs: CodeRun[] = [];
  highlightCode(
    code,
    tree,
    exportHighlighter,
    (text, classes) => {
      runs.push({ text, cls: classes || null, breakLine: false });
    },
    () => {
      if (runs.length === 0) {
        runs.push({ text: "", cls: null, breakLine: true });
      } else {
        runs[runs.length - 1].breakLine = true;
      }
    },
  );
  return runs;
}
