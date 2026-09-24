// ライブプレビューの中核: マーカーを Decoration.replace で隠し、
// カーソルが触れている間だけソースを見せる（§6.4 のリビール表）。
//
// 文書テキストは一切変更しないので、ソースが唯一の真実（T1）と位置の
// 1:1 対応は構造的に保たれ、装飾は Undo スタックに乗らない。
//
// 装飾の計算は EditorState だけで完結する純関数 previewDecorations に
// 置き、ViewPlugin は可視範囲で呼ぶだけ（T6）。ヘッドレスでテストできる。

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
} from "@codemirror/state";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { renderMath } from "./math";
import { mathSpanAt } from "../markdown/math-span";
import { splitImageAlt } from "../markdown/image-size";
import { EmbedWidget } from "./embed";
import {
  type ColorSpan,
  isSpanClose,
  parseColorSpan,
  spanStyleOf,
} from "../lib/text-color";
import { splitFenceInfo } from "../markdown/fence-info";

import {
  hideQuoteMarks,
  revealModeChanged,
  sourceModeField,
  touchesBlockZone,
  touchesLine,
  touchesSelection,
  typingLineField,
  withTrailingSpace,
  wysiwygField,
} from "./live-preview-reveal";
import { blockTheme, style } from "./live-preview-theme";
import {
  BULLET_HANG,
  BulletWidget,
  CheckboxWidget,
  FileNameWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  REMOTE_RE,
  SetextRuleWidget,
  bulletGlyph,
} from "./live-preview-widgets";
import {
  blockWidgetField,
  mermaidCode,
  pushLineClass,
  tableField,
} from "./live-preview-zones";

// 19-2 で 5 つに分けた。外からの import 先はこのファイルのまま
export * from "./live-preview-reveal";
export * from "./live-preview-widgets";
export * from "./live-preview-table-data";
export * from "./live-preview-zones";
export * from "./live-preview-theme";

// 隠す対象のインラインマーカー（§6.4 のリビール表のインライン分）。
// URL はマーカーではないが「`(url)` 部分を隠す」規則なのでここに含める
const MARK_NODES = new Set([
  "EmphasisMark",
  "HeaderMark",
  "StrikethroughMark",
  "HighlightMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "WikiLinkMark",
]);

/// 先頭の空白の幅（ch）。タブは 4 字ぶんとして数える
function leadWidthCh(lead: string): number {
  let width = 0;
  for (const char of lead) width += char === "\t" ? 4 : 1;
  return width;
}

/// 開きの `<span style="…">` から、対になる `</span>` を同じ親の中で探す。
/// 受けない style なら null（素のまま）。入れ子は深さで数える
function colorSpanAt(
  state: EditorState,
  open: SyntaxNode,
): { open: SyntaxNode; close: SyntaxNode; color: ColorSpan } | null {
  const style = spanStyleOf(state.sliceDoc(open.from, open.to));
  if (style === null) return null;
  const color = parseColorSpan(style);
  if (!color) return null;
  let depth = 0;
  for (let next = open.nextSibling; next; next = next.nextSibling) {
    if (next.name !== "HTMLTag") continue;
    const tag = state.sliceDoc(next.from, next.to);
    if (/^<span[\s>]/i.test(tag)) depth++;
    else if (isSpanClose(tag)) {
      if (depth === 0) return { open, close: next, color };
      depth--;
    }
  }
  return null;
}

/// 色は CSS 変数で渡す。ダークテーマでの明度の持ち上げは CSS 側で行う
function colorVariables(color: ColorSpan): string {
  const parts: string[] = [];
  if (color.color) parts.push(`--text-color: ${color.color}`);
  if (color.background) parts.push(`--text-bg: ${color.background}`);
  return parts.join("; ");
}

function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

/// `from..to` の範囲のライブプレビュー装飾を計算する（EditorState だけで動く）。
export function previewDecorations(
  state: EditorState,
  from: number,
  to: number,
): Range<Decoration>[] {
  // ソースモード中は装飾ゼロ = 生の Markdown（構文の色付けだけ残る）
  if (state.field(sourceModeField, false)) return [];
  // 選択範囲があるとき、交差するブロック（行）は全表示にする（§6.4）。
  // 選択 → コピーの直前に、何をコピーするか見えるようにするため
  const hasSelection = state.selection.ranges.some((range) => !range.empty);
  const lineSelected = (pos: number) => hasSelection && touchesLine(state, pos);
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      // --- 表: 生のソースのまま触らない（描画は tableDecorations = StateField
      //     の担当。表示中もリビール中も、中のマーカー隠しは掛けない）。
      //     ただし引用の中の表の継続行 `> ` は隠す（Lezer は継続行の QuoteMark
      //     を葉ブロックの子に置く。棚卸し 2026-09-17）
      if (node.name === "Table") {
        hideQuoteMarks(state, node.node, out);
        return false;
      }
      // --- 脚注の定義 `[^1]: 本文` と参照の定義 `[foo]: url` は生のまま。
      //     Lezer では LinkReference で、中の URL 扱いの部分（= 定義の本文）を
      //     隠すと画面に `[^1]` だけが残る（参照実装は定義の本文を残す。
      //     棚卸し 2026-09-17）
      if (node.name === "LinkReference") return false;
      // --- 画像: 行まるごとが画像 1 つのときだけ絵に置き換える（ADR-0004）。
      //     文中の画像はリンク扱い（マーカー隠しに任せる）
      if (node.name === "Image") {
        const line = state.doc.lineAt(node.from);
        const wholeLine =
          state.sliceDoc(node.from, node.to) === line.text.trim();
        if (!wholeLine || touchesLine(state, node.from)) return;
        const urlNode = node.node.getChild("URL");
        if (!urlNode) return;
        const url = state.sliceDoc(urlNode.from, urlNode.to);
        if (REMOTE_RE.test(url)) return; // 遠隔は絵にしない
        const marks = node.node.getChildren("LinkMark");
        const raw =
          marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
        // `![説明|300](道)` の大きさ（6-8）
        const { alt, width, height } = splitImageAlt(raw);
        out.push(
          Decoration.replace({
            widget: new ImageWidget(url, alt, width, height),
          }).range(node.from, node.to),
        );
        return false; // 中のマーカー隠しは重ねない
      }
      // --- 埋め込み（ADR-0058）: 行まるごとのときだけ、別のノートの中身を
      //     読み専用の入れ子で描く。文中はリンクのまま
      if (node.name === "Embed") {
        const line = state.doc.lineAt(node.from);
        const wholeLine =
          state.sliceDoc(node.from, node.to) === line.text.trim();
        // 埋め込みは書く面を持たない。プレビューモードでもカーソルで生に戻す
        // （表・図と同じ作法。2026-09-17 に決めた）
        if (!wholeLine || touchesBlockZone(state, line.from, line.to)) return;
        const target = state.sliceDoc(node.from + 3, node.to - 2).trim();
        out.push(
          Decoration.replace({ widget: new EmbedWidget(target) }).range(
            node.from,
            node.to,
          ),
        );
        return false;
      }
      // --- 数式ブロックと Mermaid は**行をまたぐ**ので、ここでは作らない。
      //     CM6 は plugin 由来の装飾にブロック構造の変更を許さない
      //     （ADR-0035 が表で踏んだ罠。blockWidgetField が担う）
      if (node.name === "MathBlock") return false;
      // --- 数式（ADR-0036）: キャレットが触れている間は生の LaTeX に戻す
      if (node.name === "InlineMath") {
        if (touchesSelection(state, node.from, node.to)) return false;
        const found = mathSpanAt(state.sliceDoc(node.from, node.to), 0);
        if (!found) return false;
        const mathml = renderMath(found.latex, found.display);
        // 組めない式は生のまま（書いた人が直せる状態を保つ）
        if (!mathml) return false;
        out.push(
          Decoration.replace({
            widget: new MathWidget(mathml, found.display),
          }).range(node.from, node.to),
        );
        return false;
      }
      // --- 文字色の span（ADR-0061）: 受けるものだけ、タグを隠して中に色
      if (node.name === "HTMLTag") {
        const span = colorSpanAt(state, node.node);
        if (!span) return;
        // 中身が無い（開きと閉じが隣接）と mark が空になり、CM6 が投げて
        // プラグインごと止まる → その文書の装飾が全部消える（棚卸し 2026-09-17）
        if (span.close.from > span.open.to) {
          out.push(
            Decoration.mark({
              attributes: {
                class: "cm-text-color",
                style: colorVariables(span.color),
              },
            }).range(span.open.to, span.close.from),
          );
        }
        if (
          !lineSelected(node.from) &&
          !touchesSelection(state, span.open.from, span.close.to)
        ) {
          out.push(Decoration.replace({}).range(span.open.from, span.open.to));
          out.push(
            Decoration.replace({}).range(span.close.from, span.close.to),
          );
        }
        return;
      }
      // --- インラインマーカー: 親の範囲にカーソルが触れている間は見せる
      if (MARK_NODES.has(node.name)) {
        if (lineSelected(node.from)) return;
        const parent = node.node.parent;
        if (parent && touchesSelection(state, parent.from, parent.to)) return;
        // オートリンク `<url>` は URL **が本文**。隠すのは山括弧だけ
        //（両方隠すと行から丸ごと消える — レビュー 2026-09-04）
        if (node.name === "URL" && parent?.name === "Autolink") return;
        // Setext の下線（`===` / `---`）は線として描く（空行を残さない）
        if (
          node.name === "HeaderMark" &&
          parent?.name.startsWith("SetextHeading")
        ) {
          out.push(
            Decoration.replace({ widget: new SetextRuleWidget() }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        let end = node.to;
        if (node.name === "HeaderMark") end = withTrailingSpace(state, end);
        out.push(Decoration.replace({}).range(node.from, end));
        return;
      }
      switch (node.name) {
        // --- 引用: `> ` を隠し、行に縦バーのクラスを付ける
        case "Blockquote":
          // 可視範囲の外まで行の装飾を積まない（T6。巨大な引用で全行に載っていた）
          pushLineClass(
            out,
            state,
            Math.max(node.from, from),
            Math.min(node.to, to),
            "cm-blockquote-line",
          );
          return;
        case "QuoteMark": {
          if (touchesLine(state, node.from)) return;
          out.push(
            Decoration.replace({}).range(
              node.from,
              withTrailingSpace(state, node.to),
            ),
          );
          return;
        }
        // --- コードブロック: 全行に背景、フェンス行はブロック外にいる間隠す
        case "FencedCode": {
          // 引用の中のフェンスの継続行 `> `（Table と同じ理由）
          hideQuoteMarks(state, node.node, out);
          // Mermaid の図は blockWidgetField が作る（行をまたぐ装飾は
          // plugin 由来では効かない）。ただし blockWidgetField が見るのは
          // トップレベルだけなので、引用やリストの中の図はコードの帯で見せる
          // （以前は帯も図も無い生テキストだった。レビュー 2026-09-24 / 21-3）
          if (
            mermaidCode(state, node.node) !== null &&
            node.node.parent?.name === "Document"
          ) {
            return false;
          }
          // ` ```python:aaa.py ` のファイル名は画面にも出す（ADR-0008）
          const info = node.node.getChild("CodeInfo");
          const fileName = info
            ? splitFenceInfo(state.sliceDoc(info.from, info.to)).fileName
            : null;
          // **帯を掛けるのは中身の行だけ。** フェンス（```）は書き方であって
          // 中身ではない（`:::note` と同じ扱いに揃えた。実機報告 2026-09-04）。
          // ただしファイル名があるときは開きフェンスの行も帯に入れる —
          // ラベルが帯の外に浮くと、どのブロックの名前か結び付かない
          // （Qiita 風の収まり。実機報告 2026-09-04）
          const fenceFirst = state.doc.lineAt(node.from);
          const fenceLast = state.doc.lineAt(node.to);
          const bandFrom = fileName ? fenceFirst.from : fenceFirst.to + 1;
          // 閉じが無い書きかけでは last はコードの実データ行。帯から外すと、
          // いま打っている当の行だけ素の背景になる（棚卸し 2026-09-17）
          const fenceClosed = node.node.getChildren("CodeMark").length >= 2;
          const bandTo = fenceClosed ? fenceLast.from - 1 : fenceLast.to;
          if (fenceLast.from > fenceFirst.to || fileName) {
            // 帯も可視範囲の中だけ（T6）
            const clippedFrom = Math.max(bandFrom, from);
            const clippedTo = Math.min(Math.max(bandFrom, bandTo), to);
            if (clippedFrom <= clippedTo) {
              pushLineClass(
                out,
                state,
                clippedFrom,
                clippedTo,
                "cm-codeblock-line",
              );
            }
          }
          // 中へは潜らない（false を返す）。フェンスの中はコード例で、
          // 入れ子の木（codeLanguages のマウント）まで装飾すると
          // 見出しや強調のマーカーが隠れて読めない（レビュー 2026-09-04）
          if (touchesSelection(state, node.from, node.to)) return false;
          const first = state.doc.lineAt(node.from);
          const last = state.doc.lineAt(node.to);
          out.push(
            Decoration.replace(
              fileName ? { widget: new FileNameWidget(fileName) } : {},
            ).range(first.from, first.to),
          );
          // 閉じフェンスの行は**閉じているときだけ**隠す。閉じの無い
          // 書きかけでは last はコードの実データ行で、隠すと「書いた行が
          // 消えた」ように見える（input-assist と同じ CodeMark 数の判定）
          if (fenceClosed && last.from > first.from) {
            out.push(Decoration.replace({}).range(last.from, last.to));
          }
          return false;
        }
        // --- 水平線: 線の描画に置き換える
        case "HorizontalRule": {
          // 書く面を持たないので、プレビューモードでもカーソルで生に戻す
          if (touchesBlockZone(state, node.from, node.to)) return;
          out.push(
            Decoration.replace({ widget: new HrWidget() }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        // --- リスト: 箇条書きの `- ` は点で描く（番号付きは残す）。
        //     タスク（`- [ ]`）はチェックボックスに置き換える
        case "ListMark": {
          const item = node.node.parent;
          const kind = item?.parent?.name;
          if (!item || (kind !== "BulletList" && kind !== "OrderedList")) {
            return;
          }
          const marker = item.getChild("Task")?.getChild("TaskMarker");
          // **折り返しは点・番号の後ろに揃える**（ぶら下げ。要望 2026-09-10）。
          // 幅は「先頭の空白の字数（ch）+ 印の幅」。印の幅は描く側と同じ値を
          // 使う（点 1.2em / チェックボックス 1.15em+0.4em / 番号は字数 ch）。
          // カーソルが乗って原文が見えている間も外さない — 行が跳ねる
          const line = state.doc.lineAt(node.from);
          const lead = state.sliceDoc(line.from, node.from);
          const indent = /^\s*$/.test(lead) ? leadWidthCh(lead) : 0;
          const markerText = state.sliceDoc(node.from, node.to);
          const markWidth =
            kind === "OrderedList"
              ? `${markerText.length + 1}ch`
              : marker
                ? "1.55em"
                : BULLET_HANG;
          out.push(
            Decoration.line({
              class: "cm-hang",
              attributes: { style: `--hang: calc(${indent}ch + ${markWidth})` },
            }).range(line.from),
          );
          if (kind === "OrderedList") {
            // 番号は隠さない（ADR-0026）。字の幅がフォントで違っても折り返し
            // と揃うよう、印そのものを同じ幅の箱にする
            out.push(
              Decoration.mark({
                attributes: {
                  class: "cm-list-number",
                  style: `width: ${markWidth}`,
                },
              }).range(node.from, withTrailingSpace(state, node.to)),
            );
            // 番号付きのやること `1. [ ]` も箱にする（GFM もやること。番号は
            // 残して `[ ]` だけ置き換える。棚卸し 2026-09-17）
            if (marker && !touchesLine(state, node.from)) {
              const checked = state
                .sliceDoc(marker.from, marker.to)
                .toLowerCase()
                .includes("x");
              out.push(
                Decoration.replace({
                  widget: new CheckboxWidget(checked),
                }).range(marker.from, withTrailingSpace(state, marker.to)),
              );
            }
            return;
          }
          if (touchesLine(state, node.from)) return;
          if (marker) {
            const checked = state
              .sliceDoc(marker.from, marker.to)
              .toLowerCase()
              .includes("x");
            out.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked),
              }).range(node.from, withTrailingSpace(state, marker.to)),
            );
          } else {
            const depth = listDepth(node.node);
            out.push(
              Decoration.replace({
                widget: new BulletWidget(bulletGlyph(depth - 1)),
              }).range(node.from, withTrailingSpace(state, node.to)),
            );
          }
          return;
        }
      }
    },
  });
  return out;
}

const hideMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /// 直近の構築時点で構文解析が届いていた位置
    parsedTo = 0;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const modeChanged = update.transactions.some(revealModeChanged);
      // 表と同じ理由で**解析の進みも見る**（画面を動かさないまま解析が
      // 追いついたとき、装飾が掛からないまま残る）。判定は「届いた位置が
      // 伸びたか」— オブジェクト同一性だと打鍵のたびに再構築になる
      const parsed = syntaxTree(update.state).length;
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        modeChanged ||
        parsed > this.parsedTo
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      this.parsedTo = syntaxTree(view.state).length;
      const ranges: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        ranges.push(...previewDecorations(view.state, from, to));
      }
      return RangeSet.of(ranges, true);
    }
  },
  { decorations: (v) => v.decorations },
);

export const livePreview = [
  sourceModeField,
  wysiwygField,
  typingLineField,
  // `Mod-/` はメニュー（lib.rs の source-mode）が持つ。ここには置かない —
  // 同じキーを 2 か所に置くと、届き方次第で 2 回切り替わって何も起きない
  // （2026-09-13 の見落とし確認で外した）
  hideMarkers,
  tableField,
  blockWidgetField,
  blockTheme,
];

/// 見た目（太字・見出しの大きさ・リンクの色…）。**ソースモードでは外す。**
///
/// ソースモードは「書いたとおりを見る」ための表示（`Cmd+/`）。記号を出す
/// だけで太字や見出しの大きさが残っていると、**素のテキストに見えない**
/// （実機報告 2026-09-06）。装飾はここに集めて、丸ごと外せるようにする。
export function editorHighlights(sourceMode: boolean): Extension[] {
  return sourceMode ? [] : [syntaxHighlighting(style)];
}
