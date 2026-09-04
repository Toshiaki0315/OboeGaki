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
import container from "markdown-it-container";
import { mathSpanAt, renderMath } from "../editor/math";
import { frontMatterRange } from "../editor/frontmatter";
import { splitFenceInfo } from "../editor/code-blocks";
import {
  DEFAULT_NOTE_KIND,
  NOTE_KINDS,
  UNKNOWN_NOTE_KIND,
} from "../editor/note-container";
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

/// `:::note warn` の `warn`。省略は `info`、知らない綴りは別扱い
/// （**画面と同じ規則**。片方だけ寄せ方を変えると、画面は灰色なのに
/// 書き出しは青、という食い違いが起きる）。
function noteKind(info: string): string {
  const parts = info.trim().split(/\s+/);
  if (parts.length <= 1) return DEFAULT_NOTE_KIND;
  return (NOTE_KINDS as readonly string[]).includes(parts[1])
    ? parts[1]
    : UNKNOWN_NOTE_KIND;
}

function renderer() {
  const md = new MarkdownIt("commonmark", { html: false })
    .enable(["table", "strikethrough"])
    .use(footnote)
    .use(taskLists)
    // `:::note info` の囲み（B-3 / Qiita 記法）
    .use(container, "note", {
      // `note` と種類で 2 語まで（`:::note warn extra` は囲みにしない）
      validate: (params: string) => {
        const parts = params.trim().split(/\s+/);
        return parts[0] === "note" && parts.length <= 2;
      },
      render: (tokens: { nesting: number; info: string }[], index: number) =>
        tokens[index].nesting === 1
          ? `<div class="note note-${noteKind(tokens[index].info)}">\n`
          : "</div>\n",
    });
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
  /* コードの配色（TASKS 4-4 / ADR-0008）。App.css と同じ組を持たせる。
     **スタイルシートも JS も外から読まない**ので、1 枚で完結したまま
     読む人の明暗に合う */
  :root { --code-name-bg: #63636b; --code-name-fg: #ffffff;
          --code-keyword: #007020; --code-string: #4070a0; --code-comment: #60a0b0;
          --code-number: #40a070; --code-type: #0e84b5; --code-func: #06287e;
          --code-def: #06287e; --code-prop: #517918; }
  @media (prefers-color-scheme: dark) {
    :root { --code-name-bg: #5a5a63; --code-name-fg: #f5f5f7;
            --code-keyword: #ff7b72; --code-string: #a5d6ff; --code-comment: #8b949e;
            --code-number: #79c0ff; --code-type: #ffa657; --code-func: #d2a8ff;
            --code-def: #d2a8ff; --code-prop: #7ee787; }
  }
  .tok-keyword { color: var(--code-keyword); }
  .tok-string { color: var(--code-string); }
  .tok-comment { color: var(--code-comment); font-style: italic; }
  .tok-number { color: var(--code-number); }
  .tok-type { color: var(--code-type); }
  .tok-func { color: var(--code-func); }
  .tok-def { color: var(--code-def); }
  .tok-prop { color: var(--code-prop); }
  .code-block { margin: 1em 0; }
  .code-name { display: inline-block; font-size: 0.8em; padding: 0.1em 0.6em;
               border-radius: 6px 6px 0 0; background: var(--code-name-bg);
               color: var(--code-name-fg); font-family: ui-monospace, Menlo, monospace; }
  .code-block pre { margin-top: 0; border-top-left-radius: 0; }
  /* :::note の囲み（B-3）。画面と同じ組を持たせる */
  :root { --note-info: #2E9E5B; --note-warn: #B26B00; --note-alert: #C0392B;
          --note-info-bg: #E8F5E9; --note-warn-bg: #FFF8E1; --note-alert-bg: #FDECEC; }
  @media (prefers-color-scheme: dark) {
    :root { --note-info: #7CC47F; --note-warn: #E0A100; --note-alert: #FF6B5E;
            --note-info-bg: #1E2B21; --note-warn-bg: #2E2913; --note-alert-bg: #2E1D1B; }
  }
  .note { border-left: 3px solid currentColor; padding: 0.6em 1em;
          margin: 1em 0; border-radius: 0 6px 6px 0; }
  .note-info { border-color: var(--note-info); background: var(--note-info-bg); }
  .note-warn { border-color: var(--note-warn); background: var(--note-warn-bg); }
  .note-alert { border-color: var(--note-alert); background: var(--note-alert-bg); }
  .note-unknown { border-color: rgba(128,128,128,0.6); background: rgba(128,128,128,0.08); }
  .note > :first-child { margin-top: 0; }
  .note > :last-child { margin-bottom: 0; }
`;

/// 本文に出てくるコードブロック（言語と中身）。**色分けは非同期**
/// （パーサを読み込む）なので、書き出しの前に集めて済ませておく。
export function collectCodeBlocks(
  markdownText: string,
): { info: string; code: string }[] {
  return renderer()
    .parse(markdownText, {})
    .filter((token) => token.type === "fence" && token.info.trim())
    .map((token) => ({ info: token.info.trim(), code: token.content }));
}

/// 色分け済みコードの鍵（言語 + 中身）。
export function codeKey(info: string, code: string): string {
  return `${info}\n${code}`;
}

/// 本文だけを HTML にする（印刷 = ADR-0038 が使う）。
///
/// 書き出しと**同じ文字列**を作る（経路を分けると片方だけ直す事故が起きる
/// = ADR-0007 の判断）。
///
/// **front matter は落とす**（参照実装 core/html.py と同じ）。`id` や
/// `modified` はアプリの管理情報で、読む人には意味がない。画面にも
/// 出していないもの（frontMatterHide）を、紙や配布物にだけ出さない。
export function renderBody(
  markdownText: string,
  diagrams?: Map<string, string>,
  code?: Map<string, string>,
): string {
  const md = renderer();
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const info = token.info.trim();
    if (info === "mermaid") {
      const svg = diagrams?.get(token.content.trim());
      // **SVG をそのまま埋める**（外部リソースを参照しない = ADR-0007）
      if (svg) return `<figure class="mermaid">${svg}</figure>\n`;
    }
    if (!info) {
      return fallback
        ? fallback(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    }
    // **言語のクラスは言語だけにする**（`language-js:index.js` のままだと
    // 受け取った側の色分けが言語を見つけられない。ADR-0008）
    const { lang, fileName } = splitFenceInfo(info);
    const colored = code?.get(codeKey(info, token.content));
    const body =
      `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>` +
      `${colored ?? escapeHtml(token.content)}</code></pre>\n`;
    // ファイル名は画面にも書き出しにも出す（ADR-0008。片方だけは片手落ち）
    return fileName
      ? `<div class="code-block"><div class="code-name">${escapeHtml(fileName)}</div>${body}</div>\n`
      : body;
  };
  const range = frontMatterRange(markdownText);
  return md.render(range ? markdownText.slice(range.bodyStart) : markdownText);
}

/// 完結した HTML 文書を返す。
///
/// `diagrams` は描き終えた Mermaid 図（コード → SVG）。**描画は非同期**
/// なので呼ぶ側が先に済ませて渡す（ここは純関数のまま保つ）。無い図は
/// コードブロックのまま出す。
export function renderHtml(
  markdownText: string,
  title: string,
  diagrams?: Map<string, string>,
  code?: Map<string, string>,
): string {
  const body = renderBody(markdownText, diagrams, code);
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
