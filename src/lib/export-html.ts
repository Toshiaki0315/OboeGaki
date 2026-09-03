// Markdown → HTML の書き出し（ADR-0007 の CM6 版）。
// 参照実装 core/html.py と同じく markdown-it 系で組む
// （commonmark + table + strikethrough + 脚注 + タスク）。
// 数式は Temml で MathML にする（ADR-0036）。**画面と同じ文字列**なので、
// 書き出した HTML はフォントも JS も埋めずにどのブラウザでも組める。
// コンテナは対象外。生の HTML は無効（html: false）。
//
// 画像の src は相対パスのまま出す。埋め込み（data URL 化）は vault を
// 知っている呼び出し側の仕事。

import MarkdownIt from "markdown-it";
import { mathSpanAt, renderMath } from "../editor/math";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

// ruler.before が期待する規則の型をそのまま借りる（.mjs/.d.mts の二重解決で
// 名前で import すると別物と判定されるため）
type Md = InstanceType<typeof MarkdownIt>;
type InlineRule = Parameters<Md["inline"]["ruler"]["before"]>[2];

const ASCII_WORD = /[A-Za-z0-9_]/;

/// `::目立つ::` を <mark> にする独自インライン規則（エディタの Highlight と同じ記法）。
const highlightRule: InlineRule = (state, silent) => {
  const source = state.src;
  const start = state.pos;
  if (!source.startsWith("::", start)) return false;
  // `::` が ASCII の単語に食い込んでいるときはマーカーにしない
  // （std::vector::size を守る。エディタ側 extended-inline.ts と同じ規則）
  const before = source[start - 1];
  const afterPair = source[start + 2];
  if (
    before !== undefined &&
    ASCII_WORD.test(before) &&
    afterPair !== undefined &&
    ASCII_WORD.test(afterPair)
  ) {
    return false;
  }
  // 開き = 直後が空白でない（エディタ側の緩和 flanking と同じ向き）
  const head = source[start + 2];
  if (head === undefined || /[\s:]/.test(head)) return false;
  const close = source.indexOf("::", start + 2);
  if (close < 0) return false;
  const inner = source.slice(start + 2, close);
  if (!inner.trim() || /\n/.test(inner)) return false;
  if (/\s$/.test(inner)) return false; // 閉じ = 直前が空白でない
  if (!silent) {
    const open = state.push("mark_open", "mark", 1);
    open.markup = "::";
    const text = state.push("text", "", 0);
    text.content = inner;
    const closeToken = state.push("mark_close", "mark", -1);
    closeToken.markup = "::";
  }
  state.pos = close + 2;
  return true;
};

/// `$…$` / `$$…$$`（1 行）を MathML にする独自インライン規則。
/// 検出の規則はエディタと**同じ mathSpanAt**（2 か所に書くと画面と
/// 書き出しで見えるものがずれる）。
const mathRule: InlineRule = (state, silent) => {
  const found = mathSpanAt(state.src, state.pos);
  if (!found) return false;
  const mathml = renderMath(found.latex, found.display);
  if (!mathml) return false; // 組めない式は書いたまま出す
  if (!silent) {
    const token = state.push("html_inline", "", 0);
    token.content = mathml;
  }
  state.pos = found.end;
  return true;
};

/// `$$` だけの行で挟んだブロックを MathML にする（エディタの MathBlock と対）。
const mathBlockRule = (
  state: Parameters<Parameters<Md["block"]["ruler"]["before"]>[2]>[0],
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean => {
  const lineAt = (index: number) =>
    state.src.slice(
      state.bMarks[index] + state.tShift[index],
      state.eMarks[index],
    );
  if (lineAt(startLine).trim() !== "$$") return false;
  let line = startLine + 1;
  while (line < endLine && lineAt(line).trim() !== "$$") line++;
  if (line >= endLine) return false; // 閉じが無い
  const latex = [];
  for (let index = startLine + 1; index < line; index++) {
    latex.push(lineAt(index));
  }
  const mathml = renderMath(latex.join("\n").trim(), true);
  if (!mathml) return false;
  if (!silent) {
    const token = state.push("html_block", "", 0);
    token.content = `${mathml}\n`;
    token.map = [startLine, line + 1];
  }
  state.line = line + 1;
  return true;
};

function renderer() {
  const md = new MarkdownIt("commonmark", { html: false })
    .enable(["table", "strikethrough"])
    .use(footnote)
    .use(taskLists);
  md.inline.ruler.before("emphasis", "oboegaki_highlight", highlightRule);
  // 数式はコードより後、強調より先（`$a_b$` の `_` を強調に取られない）
  md.inline.ruler.before("emphasis", "oboegaki_math", mathRule);
  md.block.ruler.before("fence", "oboegaki_math_block", mathBlockRule);
  return md;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STYLE = `
  body { font-family: -apple-system, "Hiragino Sans", sans-serif;
         line-height: 1.8; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3 { line-height: 1.4; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em;
         background: rgba(0,0,0,0.06); border-radius: 3px; padding: 0 0.2em; }
  pre { background: rgba(0,0,0,0.05); border-radius: 6px; padding: 0.8em 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid rgba(0,0,0,0.25); margin-left: 0;
               padding-left: 1em; color: rgba(0,0,0,0.7); }
  table { border-collapse: collapse; }
  th, td { border: 1px solid rgba(0,0,0,0.3); padding: 0.3em 0.8em; text-align: left; }
  th { background: rgba(0,0,0,0.06); }
  img { max-width: 100%; }
  mark { background: rgba(255, 214, 10, 0.5); border-radius: 2px; }
  hr { border: none; border-top: 2px solid rgba(0,0,0,0.2); }
  input[type="checkbox"] { margin-right: 0.4em; }
`;

/// 完結した HTML 文書を返す。
export function renderHtml(markdownText: string, title: string): string {
  const body = renderer().render(markdownText);
  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
