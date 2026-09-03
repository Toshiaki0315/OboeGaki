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
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  type EditorState,
  Facet,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { hashtagTag, highlightTag, wikiLinkTag } from "./extended-inline";

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

/// ソースモード（Cmd+/）。ON の間はすべてのライブプレビュー装飾を止めて
/// 生の Markdown を見せる（§6.4「全マーカー: ソースモード ON で常に全表示」）。
export const setSourceMode = StateEffect.define<boolean>();

export const sourceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setSourceMode)) next = effect.value;
    }
    return next;
  },
});

export function toggleSourceMode(view: EditorView): boolean {
  view.dispatch({
    effects: setSourceMode.of(!view.state.field(sourceModeField)),
  });
  return true;
}

/// 箇条書きの点。深さで描き分ける（ADR-0026 の ● ○ ■）。
export function bulletGlyph(depth: number): string {
  const glyphs = ["●", "○", "■"];
  return glyphs[((depth % 3) + 3) % 3];
}

function touchesSelection(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/// 選択がそのブロック（行）に触れているか。ブロック系マーカーのリビール条件。
function touchesLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touchesSelection(state, line.from, line.to);
}

/// 直後が空白なら 1 文字ぶん隠す範囲を広げる（`# ` `- ` `> ` の空白）。
function withTrailingSpace(state: EditorState, end: number): number {
  return state.sliceDoc(end, end + 1) === " " ? end + 1 : end;
}

class BulletWidget extends WidgetType {
  constructor(readonly glyph: string) {
    super();
  }
  eq(other: BulletWidget): boolean {
    return other.glyph === this.glyph;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-list-bullet";
    span.textContent = this.glyph;
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return (
      other.checked === this.checked &&
      other.markerFrom === this.markerFrom &&
      other.markerTo === this.markerTo
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    // click ではなく mousedown で切り替える。click を待つと、その前の
    // mousedown をエディタが処理してカーソルがこの行へ来てしまい、
    // リビールで widget ごと消えて click が成立しない（実機で発覚）
    box.onmousedown = (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerTo,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
    };
    return box;
  }
  // チェックボックス上のイベントは widget が自分で処理し、CM6 に渡さない
  // （渡すとカーソル移動 → リビールで widget が消える）
  ignoreEvent(): boolean {
    return true;
  }
}

/// 画像参照を表示可能な src（data URL 等）へ解決する関数。アプリ側が
/// vault のルートを知っているので、Facet 経由で注入する。
export type ImageResolver = (url: string) => Promise<string | null>;

export const imageResolver = Facet.define<ImageResolver, ImageResolver>({
  combine: (values) => values[0] ?? (async () => null),
});

// 遠隔参照は絵にしない（参照実装 core/paths.py の REMOTE_SCHEMES と同じ）
const REMOTE_RE = /^(https?:|data:)/i;

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    const holder = document.createElement("span");
    holder.className = "cm-image-widget";
    holder.textContent = this.alt || this.url; // 読み込めるまでの代役
    const resolve = view.state.facet(imageResolver);
    void resolve(this.url).then((src) => {
      if (!src) return; // 読めなければ代役の文字のまま
      const image = document.createElement("img");
      image.src = src;
      image.alt = this.alt;
      holder.replaceChildren(image);
      // 画像の高さが後から確定するので、行レイアウトを測り直させる
      view.requestMeasure();
    });
    return holder;
  }
  ignoreEvent(): boolean {
    return false; // クリックでカーソルが行へ入り、ソースが現れる
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-hr-widget";
    return rule;
  }
}

function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

/// 各行に行クラスを付ける（引用の縦バー・コードブロックの背景）。
function pushLineClass(
  out: Range<Decoration>[],
  state: EditorState,
  from: number,
  to: number,
  className: string,
) {
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    out.push(Decoration.line({ class: className }).range(line.from));
    if (line.to >= to) break;
    pos = line.to + 1;
  }
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
        const alt =
          marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
        out.push(
          Decoration.replace({ widget: new ImageWidget(url, alt) }).range(
            node.from,
            node.to,
          ),
        );
        return false; // 中のマーカー隠しは重ねない
      }
      // --- インラインマーカー: 親の範囲にカーソルが触れている間は見せる
      if (MARK_NODES.has(node.name)) {
        if (lineSelected(node.from)) return;
        const parent = node.node.parent;
        if (parent && touchesSelection(state, parent.from, parent.to)) return;
        let end = node.to;
        if (node.name === "HeaderMark") end = withTrailingSpace(state, end);
        out.push(Decoration.replace({}).range(node.from, end));
        return;
      }
      switch (node.name) {
        // --- 引用: `> ` を隠し、行に縦バーのクラスを付ける
        case "Blockquote":
          pushLineClass(out, state, node.from, node.to, "cm-blockquote-line");
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
          pushLineClass(out, state, node.from, node.to, "cm-codeblock-line");
          if (touchesSelection(state, node.from, node.to)) return;
          const first = state.doc.lineAt(node.from);
          const last = state.doc.lineAt(node.to);
          out.push(Decoration.replace({}).range(first.from, first.to));
          if (last.from > first.from) {
            out.push(Decoration.replace({}).range(last.from, last.to));
          }
          return;
        }
        // --- 水平線: 線の描画に置き換える
        case "HorizontalRule": {
          if (touchesLine(state, node.from)) return;
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
          if (!item || item.parent?.name !== "BulletList") return;
          if (touchesLine(state, node.from)) return;
          const marker = item.getChild("Task")?.getChild("TaskMarker");
          if (marker) {
            const checked = state
              .sliceDoc(marker.from, marker.to)
              .toLowerCase()
              .includes("x");
            out.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, marker.from, marker.to),
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

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const modeChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setSourceMode)),
      );
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        modeChanged
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const ranges: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        ranges.push(...previewDecorations(view.state, from, to));
      }
      return RangeSet.of(ranges, true);
    }
  },
  { decorations: (v) => v.decorations },
);

const style = HighlightStyle.define([
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
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    borderRadius: "3px",
  },
  { tag: tags.link, color: "#0a84ff", textDecoration: "underline" },
  { tag: wikiLinkTag, color: "#0a84ff" },
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
const blockTheme = EditorView.baseTheme({
  ".cm-blockquote-line": {
    borderLeft: "3px solid color-mix(in srgb, currentColor 30%, transparent)",
    paddingLeft: "10px",
  },
  ".cm-codeblock-line": {
    backgroundColor: "color-mix(in srgb, currentColor 6%, transparent)",
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: "0.9em",
  },
  ".cm-list-bullet": {
    display: "inline-block",
    width: "1.2em",
    opacity: "0.75",
    fontSize: "0.7em",
    verticalAlign: "middle",
  },
  ".cm-task-checkbox": {
    marginRight: "0.4em",
    verticalAlign: "middle",
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
  ".cm-hr-widget": {
    display: "inline-block",
    width: "100%",
    borderTop: "2px solid color-mix(in srgb, currentColor 25%, transparent)",
    verticalAlign: "middle",
  },
});

export const livePreview = [
  sourceModeField,
  keymap.of([{ key: "Mod-/", run: toggleSourceMode }]),
  hideMarkers,
  syntaxHighlighting(style),
  blockTheme,
];
