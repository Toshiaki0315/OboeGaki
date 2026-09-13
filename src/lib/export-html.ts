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
import { DEFAULT_SUMMARY } from "../editor/details-container";
import { splitImageAlt } from "../editor/image-size";
import { parseColorSpan, styleAttribute } from "./text-color";
import {
  DEFAULT_NOTE_KIND,
  NOTE_ICONS,
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
/// `<span style="color: …">…</span>` を、受けるものだけ組み直して通す
/// （ADR-0061）。閉じが無い・受けない style は素の文字として逃がす
const COLOR_SPAN_OPEN_RE = /^<span\s+style\s*=\s*"([^"]*)"\s*>/i;
const colorSpanRule: InlineRule = (state, silent) => {
  const source = state.src;
  const start = state.pos;
  if (source.charCodeAt(start) !== 0x3c /* < */) return false;
  const opened = COLOR_SPAN_OPEN_RE.exec(source.slice(start));
  if (!opened) return false;
  const color = parseColorSpan(opened[1]);
  if (!color) return false;
  const innerStart = start + opened[0].length;
  const close = source.indexOf("</span>", innerStart);
  if (close < 0) return false;
  if (!silent) {
    const open = state.push("color_span_open", "span", 1);
    open.attrSet("style", styleAttribute(color));
    // 中身はふつうの Markdown として組む（太字・リンクが効く）。
    // **入れ子の解析には別の配列を渡す。** 同じ配列に組ませると、
    // markdown-it の後処理（強調・打ち消し）が自分の `tokens_meta` と
    // 食い違って落ちる — `***太字の斜体***` と色つきの字が同じ段落にあると
    // 再現した（見本づくりで発覚 2026-09-13）
    const inner: typeof state.tokens = [];
    state.md.inline.parse(
      source.slice(innerStart, close),
      state.md,
      state.env,
      inner,
    );
    state.tokens.push(...inner);
    state.push("color_span_close", "span", -1);
  }
  state.pos = close + "</span>".length;
  return true;
};

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
    token.meta = { latex: found.latex }; // Word 書き出しは MathML を置けないので元の字を使う
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
    token.meta = { latex: latex.join("\n").trim() };
    token.map = [startLine, line + 1];
  }
  state.line = line + 1;
  return true;
};

/// 行まるごとの `![[名前]]` / `![[名前#見出し]]`（ADR-0058）
export const EMBED_LINE_RE = /^!\[\[([^\]|]+)\]\]\s*$/;

/// 本文の中の埋め込みの対象（`名前#見出し` の字面）。書き出しの前に App が
/// 解決して `embeds` に入れる
export function collectEmbeds(markdownText: string): string[] {
  const found: string[] = [];
  let inFence = false;
  for (const line of markdownText.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = EMBED_LINE_RE.exec(line.trim());
    if (match && !found.includes(match[1].trim())) found.push(match[1].trim());
  }
  return found;
}

/// 埋め込みの展開（ADR-0058）。`env.embeds`（対象 → 本文）にあるものだけ。
/// 中身の解析には embeds を渡さない（深さ 1。中の埋め込みは字面のまま）
const embedRule = (
  state: Parameters<Parameters<Md["block"]["ruler"]["before"]>[2]>[0],
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean => {
  const line = state.src
    .slice(
      state.bMarks[startLine] + state.tShift[startLine],
      state.eMarks[startLine],
    )
    .trim();
  const match = EMBED_LINE_RE.exec(line);
  if (!match) return false;
  const embeds = (state.env as { embeds?: Map<string, string> }).embeds;
  const text = embeds?.get(match[1].trim());
  if (text === undefined) return false;
  if (silent) return true;
  const open = state.push("embed_open", "section", 1);
  open.info = match[1].trim();
  open.map = [startLine, startLine + 1];
  state.md.block.parse(
    text,
    state.md,
    { ...state.env, embeds: undefined },
    state.tokens,
  );
  state.push("embed_close", "section", -1);
  state.line = startLine + 1;
  return true;
};

/// Qiita から貼った `<details><summary>…</summary>` … `</details>` を
/// 本物の折りたたみとして通す（TASKS 6-2 の「読むときだけ受ける」）。
///
/// **通すのはこの形だけ。** `html: false` は変えない — ここで開けると
/// 貼り付けた本文の中の任意のタグが素通りする。開き・閉じ・呼び名以外は
/// ふつうの Markdown として組む。
const detailsHtmlRule = (
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
  const opened = DETAILS_HTML_OPEN.exec(lineAt(startLine).trim());
  if (!opened) return false;
  let line = startLine + 1;
  while (line < endLine && !DETAILS_HTML_CLOSE.test(lineAt(line).trim())) {
    line++;
  }
  if (line >= endLine) return false; // 閉じが無い
  if (silent) return true;
  const open = state.push("details_open", "details", 1);
  open.block = true;
  open.info = opened[1]?.trim() ?? "";
  open.map = [startLine, line + 1];
  // 中身はふつうの Markdown（囲みと同じ）
  const lineMax = state.lineMax;
  state.lineMax = line;
  state.md.block.tokenize(state, startLine + 1, line);
  state.lineMax = lineMax;
  const close = state.push("details_close", "details", -1);
  close.block = true;
  state.line = line + 1;
  return true;
};

const DETAILS_HTML_OPEN = /^<details>[ \t]*(?:<summary>(.*?)<\/summary>)?$/;
const DETAILS_HTML_CLOSE = /^<\/details>$/;

/// 折りたたみの開きのタグ。呼び名は文字として出す（`<` を書いても壊れない）。
///
/// **書き出しでは開いた形で出す**（`open`）。畳んだまま出すと、印刷したときに
/// その中身が紙から丸ごと消える。読む人は畳める（畳む手は残っている）。
function detailsOpen(summary: string): string {
  return `<details open>\n<summary>${escapeHtml(summary || DEFAULT_SUMMARY)}</summary>\n`;
}

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
    })
    // `:::details 呼び名` の折りたたみ（6-2）。呼び名は何語でもよい
    .use(container, "details", {
      validate: (params: string) => /^details(\s|$)/.test(params.trim()),
      render: (tokens: { nesting: number; info: string }[], index: number) =>
        tokens[index].nesting === 1
          ? detailsOpen(
              tokens[index].info.trim().slice("details".length).trim(),
            )
          : "</details>\n",
    });
  md.inline.ruler.before("emphasis", "oboegaki_highlight", highlightRule);
  // 文字色の span（ADR-0061）。生の HTML は通さないまま、色だけ組み直す
  md.inline.ruler.before("emphasis", "oboegaki_color_span", colorSpanRule);
  md.renderer.rules.color_span_open = (tokens, index) =>
    `<span style="${escapeHtml(String(tokens[index].attrGet("style") ?? ""))}">`;
  md.renderer.rules.color_span_close = () => "</span>";
  // 数式はコードより後、強調より先（`$a_b$` の `_` を強調に取られない）
  md.inline.ruler.before("emphasis", "oboegaki_math", mathRule);
  md.block.ruler.before("fence", "oboegaki_math_block", mathBlockRule);
  // 貼り付けた `<details>`。フェンスより後に見るので、コード例は素通り
  md.block.ruler.before("paragraph", "oboegaki_details_html", detailsHtmlRule);
  // 埋め込み `![[名前]]`（ADR-0058）。渡された本文を Markdown として組む。
  // 解決できないものは素の文字のまま（段落）
  md.block.ruler.before("paragraph", "oboegaki_embed", embedRule);
  md.renderer.rules.embed_open = (tokens, index) =>
    `<section class="embed" data-note="${escapeHtml(tokens[index].info)}">\n`;
  md.renderer.rules.embed_close = () => "</section>\n";
  // 画像の大きさ（6-8）。`![説明|300](道)` の `|300` を幅と高さに移す
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const raw = token.children?.reduce((text, c) => text + c.content, "") ?? "";
    const { alt, width, height } = splitImageAlt(raw);
    if (width !== undefined) {
      // **説明から大きさの字は落とす**（読み上げに `|300` を混ぜない）
      const src = String(token.attrGet("src") ?? "");
      const size =
        ` width="${width}"` +
        (height === undefined ? "" : ` height="${height}"`);
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${size}>`;
    }
    return image
      ? image(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
  md.renderer.rules.details_open = (tokens, index) =>
    detailsOpen(tokens[index].info);
  md.renderer.rules.details_close = () => "</details>\n";
  return md;
}

// 属性値にも置くので `"` `'` まで落とす（`alt` や `class` を突き破らせない）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/// 印の CSS（画面と同じ表から作る）。色は囲みの枠色を継ぐ。
const NOTE_ICON_CSS = Object.entries(NOTE_ICONS)
  .map(
    ([kind, glyph]) =>
      // 丸は種類の色、文字は囲みの地の色。綴り違い（--note-unknown は
      // 置いていない）は既定の灰色に落ちる
      `  .note-${kind} > :first-child::before { content: "${glyph}";` +
      ` background: var(--note-${kind}, rgba(128,128,128,0.6));` +
      ` color: var(--note-${kind}-bg, #fff); }`,
  )
  .join("\n");

const STYLE = `
  body { font-family: -apple-system, "Hiragino Sans", sans-serif;
         line-height: 1.8; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3 { line-height: 1.4; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em;
         background: rgba(0,0,0,0.06); border-radius: 3px; padding: 0 0.2em; }
  /* コードだけは明暗どちらでも濃い地（6-4。画面と同じ） */
  pre { background: var(--code-bg); color: var(--code-fg); border-radius: 6px;
        padding: 0.8em 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid rgba(0,0,0,0.25); margin-left: 0;
               padding-left: 1em; color: rgba(0,0,0,0.7); }
  table { border-collapse: collapse; }
  th, td { border: 1px solid rgba(0,0,0,0.3); padding: 0.3em 0.8em; text-align: left; }
  th { background: rgba(0,0,0,0.06); }
  img { max-width: 100%; }
  mark { background: rgba(255, 214, 10, 0.5); border-radius: 2px; }
  hr { border: none; border-top: 2px solid rgba(0,0,0,0.2); }
  /* 字の大きさに合わせる（画面と同じ。入力部品は font-size を継がない） */
  input[type="checkbox"] { font-size: inherit; width: 1.15em; height: 1.15em;
                           margin-right: 0.4em; vertical-align: -0.25em; }
  /* コードの配色（TASKS 4-4 / ADR-0008）。App.css と同じ組を持たせる。
     **スタイルシートも JS も外から読まない**ので、1 枚で完結したまま
     読む人の明暗に合う */
  :root { --code-bg: #22272e; --code-fg: #d5dae1;
          --code-name-bg: #63636b; --code-name-fg: #ffffff;
          --code-keyword: #ff7b72; --code-string: #a5d6ff; --code-comment: #8b949e;
          --code-number: #79c0ff; --code-type: #ffa657; --code-func: #d2a8ff;
          --code-def: #d2a8ff; --code-prop: #7ee787; }
  @media (prefers-color-scheme: dark) {
    /* 字の組は共通（6-4 で一本化）。地だけ本文との差を付ける */
    :root { --code-bg: #14171c; --code-name-bg: #5a5a63; --code-name-fg: #f5f5f7; }
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
  /* 埋め込み（ADR-0058）。左に線を引いて「別のノートの中身」と分かるように */
  .embed { border-left: 3px solid #c8c8c8; padding-left: 0.9em; margin: 1em 0; }
  /* ラベルはコードと同じ大きさ（要望 2026-09-05） */
  .code-name { display: inline-block; font-size: 0.9em; padding: 0.1em 0.6em;
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
  /* 頭の印（要望 2026-09-05）。丸の色は種類の色、文字は囲みの地の色 */
  .note > :first-child::before {
    display: inline-block; width: 1.3em; height: 1.3em; line-height: 1.3em;
    margin-right: 0.45em; border-radius: 50%; text-align: center;
    font-size: 0.85em; font-weight: 700; vertical-align: 0.05em;
  }
${NOTE_ICON_CSS}
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

/// 本文を markdown-it のトークンにする（Word 書き出し = ADR-0059 が使う）。
/// HTML と**同じ解析**（同じ規則・同じ拡張）なので、書き出し先で崩れ方が
/// 違わない。front matter は落とす
export function markdownTokens(
  markdownText: string,
  embeds?: Map<string, string>,
): ReturnType<Md["parse"]> {
  const md = renderer();
  const range = frontMatterRange(markdownText);
  return md.parse(range ? markdownText.slice(range.bodyStart) : markdownText, {
    embeds,
  });
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
  /// 埋め込みの対象 → 本文（ADR-0058。App が先に解決する）
  embeds?: Map<string, string>,
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
  return md.render(range ? markdownText.slice(range.bodyStart) : markdownText, {
    embeds,
  });
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
  embeds?: Map<string, string>,
): string {
  const body = renderBody(markdownText, diagrams, code, embeds);
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
