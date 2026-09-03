// Markdown → HTML の書き出し（ADR-0007 の CM6 版）。
// 参照実装 core/html.py と同じく markdown-it 系で組む
// （commonmark + table + strikethrough + 脚注 + タスク）。
// エディタ未対応の数式・コンテナは対象外。生の HTML は無効（html: false）。
//
// 画像の src は相対パスのまま出す。埋め込み（data URL 化）は vault を
// 知っている呼び出し側の仕事。

import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

// ruler.before が期待する規則の型をそのまま借りる（.mjs/.d.mts の二重解決で
// 名前で import すると別物と判定されるため）
type Md = InstanceType<typeof MarkdownIt>;
type InlineRule = Parameters<Md["inline"]["ruler"]["before"]>[2];

/// `::目立つ::` を <mark> にする独自インライン規則（エディタの Highlight と同じ記法）。
const highlightRule: InlineRule = (state, silent) => {
  const source = state.src;
  const start = state.pos;
  if (!source.startsWith("::", start)) return false;
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

function renderer() {
  const md = new MarkdownIt("commonmark", { html: false })
    .enable(["table", "strikethrough"])
    .use(footnote)
    .use(taskLists);
  md.inline.ruler.before("emphasis", "oboegaki_highlight", highlightRule);
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
