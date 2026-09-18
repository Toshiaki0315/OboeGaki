// ライブプレビューの見た目（HighlightStyle と blockTheme の CSS）。
// 19-2 で live-preview.ts から分けた

import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  footnoteTag,
  hashtagTag,
  highlightTag,
  mathTag,
  wikiLinkTag,
} from "./extended-inline";
import { NOTE_ICONS, UNKNOWN_NOTE_KIND } from "./note-container";

import { BULLET_FONT_SCALE, BULLET_WIDTH_EM } from "./live-preview-widgets";

export const style = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.6em" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.3em" },
  { tag: tags.heading3, fontWeight: "700", fontSize: "1.15em" },
  { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.7" },
  {
    tag: highlightTag,
    backgroundColor: "color-mix(in srgb, #ffd60a 45%, transparent)",
    borderRadius: "2px",
  },
  {
    tag: tags.monospace,
    fontFamily: "var(--mono-font, ui-monospace, 'SF Mono', Menlo, monospace)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    borderRadius: "3px",
  },
  { tag: tags.link, color: "#0a84ff", textDecoration: "underline" },
  { tag: wikiLinkTag, color: "#0a84ff" },
  {
    tag: footnoteTag,
    color: "#0a84ff",
    verticalAlign: "super",
    fontSize: "0.8em",
  },
  // 生に戻った式（キャレットが触れている間）は等幅で見せる
  { tag: mathTag, fontFamily: "ui-monospace, Menlo, monospace" },
  {
    tag: hashtagTag,
    color: "#0a84ff",
    backgroundColor: "color-mix(in srgb, #0a84ff 12%, transparent)",
    borderRadius: "999px",
    padding: "0.05em 0.5em",
  },
]);

/// ブロック装飾の見た目。旧実装の painter_overlay（paintEvent 描画）に相当する
/// ものが、CM6 では行クラスと widget + CSS で済む。
/// 印の当て方（画面用）。**表は 1 か所**（note-container）から作る。
const noteIconRules = Object.fromEntries(
  Object.entries(NOTE_ICONS).map(([kind, glyph]) => [
    `.cm-note-${kind}.cm-note-line-first::before`,
    { content: `"${glyph}"` },
  ]),
);

export const blockTheme = EditorView.baseTheme({
  // `:::note` の囲み（B-3）。実色は App.css の CSS 変数が持つ
  // （ライト / ダークを 1 か所で切り替えるため）
  ".cm-note-line": {
    paddingLeft: "10px",
    borderLeft: "3px solid var(--note-line, currentColor)",
    // 地はコードの帯と同じく**行の後ろ**に敷く（選択の塗りを覆わない。
    // 実機報告 2026-09-13 はコードの話だが、囲みも同じ作りだった）
    position: "relative",
  },
  ".cm-note-line::before": {
    content: '""',
    position: "absolute",
    inset: "0",
    background: "var(--note-bg, transparent)",
    zIndex: "-3",
  },
  ".cm-note-info": {
    "--note-line": "var(--note-info)",
    "--note-bg": "var(--note-info-bg)",
  },
  ".cm-note-warn": {
    "--note-line": "var(--note-warn)",
    "--note-bg": "var(--note-warn-bg)",
  },
  ".cm-note-alert": {
    "--note-line": "var(--note-alert)",
    "--note-bg": "var(--note-alert-bg)",
  },
  ".cm-note-unknown": {
    "--note-line": "color-mix(in srgb, currentColor 40%, transparent)",
    "--note-bg": "color-mix(in srgb, currentColor 6%, transparent)",
  },
  // 折りたたみ（6-2）。呼び名は畳んでも見えるので**太字で見出しらしく**、
  // 中身は左の線で「この中」と分かるようにする（`:::note` と同じ作法）
  ".cm-details-summary": {
    fontWeight: "600",
  },
  ".cm-details-line": {
    paddingLeft: "10px",
    borderLeft: "3px solid color-mix(in srgb, currentColor 25%, transparent)",
  },
  // 数式（ADR-0036）。ディスプレイ数式は行として中央に置く
  ".cm-math-block": {
    display: "block",
    textAlign: "center",
    margin: "0.4em 0",
  },
  ".cm-blockquote-line": {
    borderLeft: "3px solid color-mix(in srgb, currentColor 30%, transparent)",
    paddingLeft: "10px",
  },
  // **明暗どちらでも濃い地**（6-4。要望 2026-09-05）。地が濃いので、
  // 色の付かない字とキャレットの色も行に持たせる — ライトのままだと
  // 黒いキャレットが沈んで、どこを打っているか分からない
  ".cm-codeblock-line": {
    color: "var(--code-fg)",
    // キャレットの色は**ここには書かない**。drawSelection が
    // `caret-color: transparent !important` を当てるので、同じ強さで
    // 戻す必要がある — その 1 か所は selection.ts（2 か所に散らさない）
    fontFamily: "var(--mono-font, ui-monospace, 'SF Mono', Menlo, monospace)",
    fontSize: "0.9em",
    // 帯は**行の後ろ**に敷く（実機報告 2026-09-13）。行そのものの
    // background にすると、選択の塗り（drawSelection の層は z-index -2）を
    // 覆ってしまい、コードの中で何を選んでいるか見えなくなる
    position: "relative",
  },
  ".cm-codeblock-line::before": {
    content: '""',
    position: "absolute",
    inset: "0",
    background: "var(--code-bg)",
    zIndex: "-3", // 選択の層（-2）より後ろ
  },
  // 帯の内側に余白を作る（文字が縁にくっつくと窮屈に見える）
  ".cm-codeblock-line-first::before": { borderRadius: "6px 6px 0 0" },
  ".cm-codeblock-line-last::before": { borderRadius: "0 0 6px 6px" },
  ".cm-codeblock-line-first": {
    paddingTop: "0.5em",
    // コピーの印を右上に置くための基準（要望 2026-09-06）。
    // **基準が無いと印は本文の右上へ飛ぶ**（実機報告 2026-09-13）
    position: "relative",
  },
  // コードをコピーする印。**入っている間だけ**見せる（いつも出ていると
  // 本文の一部に見える）
  ".cm-copy-code": {
    position: "absolute",
    right: "0.4em",
    top: "0.3em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // 帯からはみ出さない範囲でいちばん大きく（実機報告 2026-09-13。
    // 1 行だけのブロックで実測: 帯 40px に対し印 31px、上 4 / 下 6 / 右 5 px）
    width: "2.3em",
    height: "2.3em",
    padding: "0",
    border: "none",
    borderRadius: "5px",
    background: "color-mix(in srgb, currentColor 12%, transparent)",
    color: "var(--code-fg)",
    cursor: "pointer",
    opacity: "0.75",
  },
  // 覗き見の泡（U-2）。`Cmd` を押しながら `[[…]]` に触れると冒頭が出る。
  // **黒地に白**の同じ見た目を 2 つ作らない — 補完の窓と同じ色を使う
  ".cm-note-peek": {
    position: "fixed",
    zIndex: "30",
    maxWidth: "340px",
    padding: "0.5rem 0.7rem",
    borderRadius: "8px",
    background: "var(--peek-bg, rgba(40, 40, 42, 0.96))",
    color: "var(--peek-fg, #f5f5f7)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.28)",
    fontSize: "0.85em",
    lineHeight: "1.5",
    pointerEvents: "none", // 泡の下のリンクを押せなくしない
  },
  ".cm-note-peek-title": {
    fontWeight: "600",
    marginBottom: "0.3rem",
    opacity: "0.9",
  },
  ".cm-note-peek-body": {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  // Cmd を押しながら押せる場所に重ねている間だけ指差しにする
  // （activation.ts の POINTER_CLASS。参照実装と同じ合図）
  "&.cm-activatable .cm-content": {
    cursor: "pointer",
  },
  ".cm-copy-code:hover": {
    opacity: "1",
    background: "color-mix(in srgb, currentColor 22%, transparent)",
  },
  ".cm-copy-code svg": {
    width: "1.35em",
    height: "1.35em",
  },
  ".cm-copy-code.copied": {
    color: "var(--code-prop)",
    opacity: "1",
  },
  ".cm-codeblock-line-last": {
    paddingBottom: "0.5em",
  },
  ".cm-note-line-first": {
    paddingTop: "0.5em",
    borderTopRightRadius: "6px",
  },
  // 囲みの頭の印（要望 2026-09-05。Qiita と同じ形）。丸は種類の色、
  // 文字は囲みの地の色 — 明暗どちらでも読める向きになる
  ".cm-note-line-first::before": {
    display: "inline-block",
    width: "1.3em",
    height: "1.3em",
    lineHeight: "1.3em",
    marginRight: "0.45em",
    borderRadius: "50%",
    textAlign: "center",
    fontSize: "0.85em",
    fontWeight: "700",
    verticalAlign: "0.05em",
    background: "var(--note-line)",
    color: "var(--note-bg)",
  },
  ...noteIconRules,
  // 綴り違いだけは色を直に書く。**`currentColor` は使えない** — 同じ
  // 規則で `color` を決めているので、そちらを指してしまう（丸が白く
  // なって消えた）。書き出しの CSS と同じ灰色に揃える
  ".cm-note-unknown.cm-note-line-first::before": {
    content: `"${NOTE_ICONS[UNKNOWN_NOTE_KIND]}"`,
    background: "rgba(128, 128, 128, 0.6)",
    color: "#fff",
  },
  ".cm-note-line-last": {
    paddingBottom: "0.5em",
    borderBottomRightRadius: "6px",
  },
  // ぶら下げ（要望 2026-09-10）。1 行目だけ印の幅ぶん左へ戻し、行全体を
  // 同じ幅だけ右へ寄せる。6px は CM6 の .cm-line の既定の左 padding
  ".cm-line.cm-hang": {
    textIndent: "calc(-1 * var(--hang))",
    paddingLeft: "calc(6px + var(--hang))",
  },
  // **text-indent は継承される。** 行の中の inline-block（番号の箱・点・
  // 数式など）にも掛かり、中の字が箱の左へはみ出して切れる（実機
  // 2026-09-10: 番号が半分欠け、箱だけ残って広い隙間になった）。箱の中では
  // 打ち消す。素の inline には効かない属性なので、まとめて掛けて問題ない
  ".cm-line.cm-hang *": {
    textIndent: "0",
  },
  ".cm-list-number": {
    display: "inline-block",
    whiteSpace: "pre",
  },
  // 文字色（ADR-0061）。値は CSS 変数で受け、ダークでは明度を上げる
  //（App.css の [data-theme="dark"] 側）
  ".cm-text-color": {
    color: "var(--text-color, inherit)",
    backgroundColor: "var(--text-bg, transparent)",
  },
  ".cm-list-bullet": {
    display: "inline-block",
    width: `${BULLET_WIDTH_EM}em`,
    opacity: "0.75",
    fontSize: `${BULLET_FONT_SCALE}em`,
    verticalAlign: "middle",
  },
  // **字の大きさに合わせて大きくする**（実機報告 2026-09-06）。素の
  // チェックボックスは 13px 固定で、本文を大きくすると相対的に小さく見える
  ".cm-task-checkbox": {
    // **`font-size` は継がれない**（入力部品の既定は 13px）。継がせないと
    // `em` が 13px 基準になって、本文を大きくしても付いてこない
    fontSize: "inherit",
    width: "1.15em",
    height: "1.15em",
    marginRight: "0.4em",
    // 字の中心と印の中心を合わせる（実測で詰めた）
    verticalAlign: "-0.25em",
  },
  ".cm-table-widget": {
    padding: "4px 0",
  },
  ".cm-table-widget table": {
    borderCollapse: "collapse",
    maxWidth: "100%",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    padding: "0.3em 0.8em",
    textAlign: "left",
    verticalAlign: "top",
  },
  ".cm-table-widget th": {
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    fontWeight: "700",
  },
  // セル内のインライン装飾（ADR-0031）
  ".cm-table-widget .cell-strong": { fontWeight: "700" },
  ".cm-table-widget .cell-em": { fontStyle: "italic" },
  ".cm-table-widget .cell-strike": {
    textDecoration: "line-through",
    opacity: "0.7",
  },
  ".cm-table-widget .cell-highlight": {
    backgroundColor: "color-mix(in srgb, #ffd60a 45%, transparent)",
    borderRadius: "2px",
  },
  ".cm-table-widget .cell-code": {
    fontFamily: "var(--mono-font, ui-monospace, 'SF Mono', Menlo, monospace)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    borderRadius: "3px",
    padding: "0 0.2em",
  },
  ".cm-table-widget .cell-tag": {
    color: "#0a84ff",
    backgroundColor: "color-mix(in srgb, #0a84ff 12%, transparent)",
    borderRadius: "999px",
    padding: "0.05em 0.5em",
  },
  ".cm-image-widget": {
    display: "inline-block",
    maxWidth: "100%",
  },
  ".cm-image-widget img": {
    maxWidth: "100%",
    borderRadius: "4px",
    verticalAlign: "middle",
  },
  // 絵とつまみの枠（6-8b）。つまみは絵の右下に重ね、載せたときだけ見せる
  ".cm-image-frame": {
    position: "relative",
    display: "inline-block",
    maxWidth: "100%",
  },
  ".cm-image-resize": {
    position: "absolute",
    right: "4px",
    bottom: "8px",
    width: "12px",
    height: "12px",
    borderRadius: "3px",
    border: "2px solid #fff",
    backgroundColor: "#0a84ff",
    boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.25)",
    cursor: "nwse-resize",
    opacity: "0",
    transition: "opacity 0.12s",
  },
  ".cm-image-widget:hover .cm-image-resize, .cm-image-resize.dragging": {
    opacity: "1",
  },
  ".cm-code-filename": {
    display: "inline-block",
    fontFamily: "var(--mono-font, ui-monospace, 'SF Mono', Menlo, monospace)",
    // **コードと同じ大きさ**（要望 2026-09-05）。ここは既に 0.9em の帯の
    // 中なので、更に縮めると本文の 0.7 倍になって読めない
    fontSize: "1em",
    padding: "0.1em 0.7em",
    // ラベルと 1 行目がくっついて見えた（実機報告 2026-09-13）。帯の内側の
    // 余白（0.5em）と同じだけ空ける — ファイル名があるブロックにだけ効く
    marginBottom: "0.5em",
    borderRadius: "4px",
    // 参照実装 code_name_background / foreground（ADR-0008）。
    // 実色は App.css の変数（ライト #63636B / ダーク #5A5A63 に白系文字）
    backgroundColor: "var(--code-name-bg, #63636b)",
    color: "var(--code-name-fg, #ffffff)",
  },
  ".cm-setext-rule": {
    display: "block",
    height: "0.4em",
    borderBottom: "1px solid color-mix(in srgb, currentColor 30%, transparent)",
  },
  ".cm-hr-widget": {
    display: "inline-block",
    width: "100%",
    borderTop: "2px solid color-mix(in srgb, currentColor 25%, transparent)",
    verticalAlign: "middle",
  },
});
