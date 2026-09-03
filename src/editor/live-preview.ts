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
  unfoldAll,
} from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import {
  footnoteTag,
  hashtagTag,
  highlightTag,
  mathTag,
  wikiLinkTag,
} from "./extended-inline";
import { mathSpanAt, renderMath } from "./math";
import { noteContainers, UNKNOWN_NOTE_KIND } from "./note-container";
import { renderMermaid, type MermaidTheme } from "./mermaid";
import { splitFenceInfo } from "./code-blocks";

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
/// 図の見た目（ADR-0021）。**装飾の鍵に含める**ので StateField で持つ
/// （読むだけの DOM 参照にすると、テーマを変えても古い図が残る）。
export const setDiagramTheme = StateEffect.define<MermaidTheme>();

export const diagramThemeField = StateField.define<MermaidTheme>({
  create: () => "light",
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setDiagramTheme)) next = effect.value;
    }
    return next;
  },
});

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
  const turningOn = !view.state.field(sourceModeField);
  view.dispatch({
    effects: setSourceMode.of(turningOn),
  });
  // ソースを全部見せるモードで隠れた行があっては嘘になる（ADR-0019）
  if (turningOn) unfoldAll(view);
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

/// 数式（ADR-0036）。Temml が作った MathML をそのまま置く。
/// 組むのは WebKit（macOS 13+ の MathML Core）。
class MathWidget extends WidgetType {
  constructor(
    readonly mathml: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    // 同じ式を組み直さない（打鍵の経路に入るため）
    return other.mathml === this.mathml && other.display === this.display;
  }
  toDOM(): HTMLElement {
    const host = document.createElement(this.display ? "div" : "span");
    host.className = this.display ? "cm-math cm-math-block" : "cm-math";
    // 埋めるのは Temml が組んだ MathML（外から来た文字列ではない）
    host.innerHTML = this.mathml;
    return host;
  }
  ignoreEvent(): boolean {
    return false; // 式の上を押したらキャレットを置きたい
  }
}

/// Mermaid 図（ADR-0021）。描けるまでは生のコードを見せ、出来たところで
/// 差し替える（画像 widget と同じ手口）。
class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly theme: MermaidTheme,
  ) {
    super();
  }
  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.theme === this.theme;
  }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-mermaid";
    const waiting = document.createElement("pre");
    waiting.className = "cm-mermaid-source";
    waiting.textContent = this.code; // 描けるまでの代役
    host.append(waiting);
    void renderMermaid(this.code, this.theme).then((svg) => {
      if (!svg) return; // 描けなければコードのまま（直せる状態を保つ）
      host.innerHTML = svg;
      // 図の高さが後から決まるので、行レイアウトを測り直させる
      view.requestMeasure();
    });
    return host;
  }
  ignoreEvent(): boolean {
    return false; // 図を押したらキャレットを置きたい
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

/// 表 widget に渡すデータ（ADR-0035）。抽出は純関数で行いテストする。
/// セルは「記号を落とした断片の並び」（ADR-0031 の Fragment 相当）。
/// 入れ子は種類の集合（kinds）で持つ。
export type TableAlign = "left" | "center" | "right" | null;
export type CellSegment = { text: string; kinds: string[] };
export type TableData = {
  header: CellSegment[][];
  aligns: TableAlign[];
  rows: CellSegment[][][];
};

// セル内で描き分ける種類（ADR-0031）。リンク・画像は対象外 —
// 記号だけ消すと URL が見えなくなるので生のまま見せる
const CELL_KINDS: Record<string, string> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
  Strikethrough: "strike",
  Highlight: "highlight",
  Hashtag: "tag",
};
const CELL_RAW = new Set(["Link", "Image", "Autolink", "WikiLink"]);
// セル内の強制改行（ADR-0028）。`<br>` `<br/>` `<BR />` を同義に扱う。
// 意味を持つのは表のセルの中だけ — 本文の <br> は文字のまま
const FORCED_BREAK_RE = /^<br\s*\/?>$/i;

const CELL_MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "HighlightMark",
]);

/// セルの中身を、マーカーを落とした断片の並びにする。
function cellSegments(state: EditorState, cell: SyntaxNode): CellSegment[] {
  const out: CellSegment[] = [];
  const emit = (from: number, to: number, kinds: string[]) => {
    if (from >= to) return;
    const text = state.sliceDoc(from, to);
    const last = out[out.length - 1];
    if (last && last.kinds.join(" ") === kinds.join(" ")) {
      last.text += text;
    } else {
      out.push({ text, kinds });
    }
  };
  const walk = (node: SyntaxNode, kinds: string[]) => {
    let pos = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      emit(pos, child.from, kinds);
      pos = child.to;
      if (CELL_MARKS.has(child.name)) continue; // マーカーは描かない
      if (CELL_RAW.has(child.name)) {
        emit(child.from, child.to, kinds); // 生のまま
        continue;
      }
      if (
        child.name === "HTMLTag" &&
        FORCED_BREAK_RE.test(state.sliceDoc(child.from, child.to))
      ) {
        out.push({ text: "\n", kinds: ["br"] }); // セル内の改行（ADR-0028）
        continue;
      }
      const kind = CELL_KINDS[child.name];
      if (kind === "tag") {
        emit(child.from, child.to, [...kinds, kind]); // タグは # ごと
        continue;
      }
      walk(child, kind ? [...kinds, kind] : kinds);
    }
    emit(pos, node.to, kinds);
  };
  walk(cell, []);
  // セルの端の空白を落とす
  if (out.length > 0) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((segment) => segment.text.length > 0);
}

/// 区切りセル（`:---:` など）から text-align を読む。
function alignOf(delimiter: string): TableAlign {
  const cell = delimiter.trim();
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/// Table ノードからセルの中身を取り出す（EditorState だけで動く）。
function tableData(state: EditorState, table: SyntaxNode): TableData {
  const cellsOf = (row: SyntaxNode): CellSegment[][] => {
    const cells: CellSegment[][] = [];
    for (const cell of row.getChildren("TableCell")) {
      cells.push(cellSegments(state, cell));
    }
    return cells;
  };
  const header = table.getChild("TableHeader");
  const delimiter = table.getChild("TableDelimiter");
  const aligns = delimiter
    ? state
        .sliceDoc(delimiter.from, delimiter.to)
        .replace(/^\||\|$/g, "")
        .split("|")
        .map(alignOf)
    : [];
  return {
    header: header ? cellsOf(header) : [],
    aligns,
    rows: table.getChildren("TableRow").map(cellsOf),
  };
}

class TableWidget extends WidgetType {
  readonly key: string;
  constructor(readonly data: TableData) {
    super();
    this.key = JSON.stringify(data);
  }
  eq(other: TableWidget): boolean {
    return other.key === this.key;
  }
  toDOM(): HTMLElement {
    const holder = document.createElement("div");
    holder.className = "cm-table-widget";
    const table = document.createElement("table");
    const alignAt = (index: number) => this.data.aligns[index] ?? null;
    const fill = (cell: HTMLElement, segments: CellSegment[]) => {
      for (const segment of segments) {
        if (segment.kinds.includes("br")) {
          cell.appendChild(document.createElement("br"));
          continue;
        }
        const span = document.createElement("span");
        span.textContent = segment.text;
        if (segment.kinds.length > 0) {
          span.className = segment.kinds
            .map((kind) => `cell-${kind}`)
            .join(" ");
        }
        cell.appendChild(span);
      }
    };
    const headRow = document.createElement("tr");
    this.data.header.forEach((segments, index) => {
      const cell = document.createElement("th");
      fill(cell, segments);
      const align = alignAt(index);
      if (align) cell.style.textAlign = align;
      headRow.appendChild(cell);
    });
    table.appendChild(headRow);
    for (const row of this.data.rows) {
      const tr = document.createElement("tr");
      row.forEach((segments, index) => {
        const cell = document.createElement("td");
        fill(cell, segments);
        const align = alignAt(index);
        if (align) cell.style.textAlign = align;
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    }
    holder.appendChild(table);
    return holder;
  }
  ignoreEvent(): boolean {
    return false; // クリックでカーソルが表へ入り、ソースが現れる
  }
}

/// フェンスのファイル名ラベル（ADR-0008）。` ```python:aaa.py ` の
/// aaa.py を、フェンス行を潰す代わりに出す。
class FileNameWidget extends WidgetType {
  constructor(readonly fileName: string) {
    super();
  }
  eq(other: FileNameWidget): boolean {
    return other.fileName === this.fileName;
  }
  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "cm-code-filename";
    label.textContent = this.fileName;
    return label;
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
      // --- 表: 生のソースのまま触らない（描画は tableDecorations = StateField
      //     の担当。表示中もリビール中も、中のマーカー隠しは掛けない）
      if (node.name === "Table") return false;
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
          // Mermaid の図は blockWidgetField が作る（行をまたぐ装飾は
          // plugin 由来では効かない）。ここでは背景とフェンス隠しだけ
          if (mermaidCode(state, node.node) !== null) return false;
          pushLineClass(out, state, node.from, node.to, "cm-codeblock-line");
          if (touchesSelection(state, node.from, node.to)) return;
          const first = state.doc.lineAt(node.from);
          const last = state.doc.lineAt(node.to);
          // ` ```python:aaa.py ` のファイル名は画面にも出す（ADR-0008）。
          // 無ければ今まで通りフェンス行ごと隠す
          const info = node.node.getChild("CodeInfo");
          const fileName = info
            ? splitFenceInfo(state.sliceDoc(info.from, info.to)).fileName
            : null;
          out.push(
            Decoration.replace(
              fileName ? { widget: new FileNameWidget(fileName) } : {},
            ).range(first.from, first.to),
          );
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

/// 表の装飾を計算する（ADR-0035）。範囲外にいる間は HTML の table に
/// 置き換え、触れている間は生のソース（表単位リビール = ADR-0003 決定 3）。
///
/// **ViewPlugin ではなく StateField から提供する。** CM6 はブロック構造を
/// 変える装飾（block widget・改行をまたぐ replace）を plugin 由来の
/// 装飾に許さない（実機で発覚 2026-09-04）。表は文書全体を見るが、
/// Table ノードの走査は木の上部だけで済むので軽い。
export function tableDecorations(state: EditorState): Range<Decoration>[] {
  if (state.field(sourceModeField, false)) return [];
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") {
        // 表はトップレベルのブロック。中まで潜る必要は無い
        return node.node.parent === null || node.name === "Document"
          ? undefined
          : false;
      }
      if (!touchesSelection(state, node.from, node.to)) {
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableData(state, node.node)),
            block: true,
          }).range(node.from, node.to),
        );
      }
      return false;
    },
  });
  return out;
}

/// 表の範囲とリビール状態。DecorationSet は不変オブジェクトなので、
/// 付帯情報は WeakMap でぶら下げる（field の値を DecorationSet のまま
/// 保ち、provide とテストを単純にするため）
type TableMeta = { zones: { from: number; to: number }[]; revealKey: string };
const tableMeta = new WeakMap<DecorationSet, TableMeta>();

function tableZones(state: EditorState): { from: number; to: number }[] {
  const zones: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table") {
        zones.push({ from: node.from, to: node.to });
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return zones;
}

function revealKeyOf(
  state: EditorState,
  zones: { from: number; to: number }[],
): string {
  return zones
    .map((zone, index) =>
      touchesSelection(state, zone.from, zone.to) ? index : -1,
    )
    .filter((index) => index >= 0)
    .join(",");
}

function computeTableSet(state: EditorState): DecorationSet {
  const set = RangeSet.of(tableDecorations(state), true);
  const zones = tableZones(state);
  tableMeta.set(set, { zones, revealKey: revealKeyOf(state, zones) });
  return set;
}

/// この編集は表に関わり得るか。変更行の前後 1 行（旧文書側も）に `|` が
/// あるか、挿入テキストが `|` を含むときだけ真。表の生成・破壊は
/// 必ず `|` の近くで起きる、という近似
function editNearTables(tr: {
  startState: EditorState;
  newDoc: EditorState["doc"];
  changes: {
    iterChanges: (
      f: (
        fromA: number,
        toA: number,
        fromB: number,
        toB: number,
        inserted: { toString: () => string },
      ) => void,
    ) => void;
  };
}): boolean {
  let near = false;
  const hasPipeAround = (doc: EditorState["doc"], from: number, to: number) => {
    const start = doc.lineAt(Math.min(from, doc.length)).number;
    const end = doc.lineAt(Math.min(to, doc.length)).number;
    for (
      let n = Math.max(1, start - 1);
      n <= Math.min(doc.lines, end + 1);
      n++
    ) {
      if (doc.line(n).text.includes("|")) return true;
    }
    return false;
  };
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (near) return;
    if (inserted.toString().includes("|")) {
      near = true;
      return;
    }
    if (
      hasPipeAround(tr.newDoc, fromB, toB) ||
      hasPipeAround(tr.startState.doc, fromA, toA)
    ) {
      near = true;
    }
  });
  return near;
}

/// ```mermaid のフェンスなら中身。違えば null。
function mermaidCode(state: EditorState, node: SyntaxNode): string | null {
  const info = node.getChild("CodeInfo");
  const language = info ? state.sliceDoc(info.from, info.to).trim() : "";
  if (language !== "mermaid") return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  if (last.from <= first.to) return null;
  const code = state
    .sliceDoc(first.to + 1, last.from)
    .replace(/\n$/, "")
    .trim();
  return code || null;
}

/// 行をまたぐ装飾（数式ブロック・Mermaid の図）。
///
/// **StateField から提供する。** CM6 はブロック構造を変える装飾を plugin
/// 由来の装飾に許さず、**投げる**（画面が真っ白になる。ADR-0035 が表で
/// 踏んだ罠を、数式と図でもう一度踏んだ = 実機で発覚 2026-09-04）。
export function blockWidgetDecorations(
  state: EditorState,
): Range<Decoration>[] {
  if (state.field(sourceModeField, false)) return [];
  const out: Range<Decoration>[] = [];
  // `:::note` の囲み（B-3）。行の装飾なので木のノードは要らない
  for (const note of noteContainers(state.doc)) {
    const first = state.doc.lineAt(note.from).number;
    const last = state.doc.lineAt(note.to).number;
    for (let number = first; number <= last; number++) {
      const line = state.doc.line(number);
      out.push(
        Decoration.line({ class: `cm-note-line cm-note-${note.kind}` }).range(
          line.from,
        ),
      );
    }
    // **知らない綴りは区切り行も隠さない**（間違いに気づく手掛かりを残す）。
    // キャレットが触れている間も生のまま（他のブロックと同じ作法）
    if (
      note.kind === UNKNOWN_NOTE_KIND ||
      touchesSelection(state, note.from, note.to)
    ) {
      continue;
    }
    out.push(Decoration.replace({}).range(note.open.from, note.open.to));
    out.push(Decoration.replace({}).range(note.close.from, note.close.to));
  }
  const theme = state.field(diagramThemeField, false) ?? "light";
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "MathBlock") {
        // リビールは**式全体**（途中の行だけ生に戻すと、式の断片と絵が
        // 同時に見えて読めない）
        if (touchesSelection(state, node.from, node.to)) return false;
        const source = state.sliceDoc(node.from, node.to);
        const latex = source.split("\n").slice(1, -1).join("\n").trim();
        const mathml = latex ? renderMath(latex, true) : null;
        if (!mathml) return false;
        out.push(
          Decoration.replace({
            widget: new MathWidget(mathml, true),
            block: true,
          }).range(node.from, node.to),
        );
        return false;
      }
      if (node.name === "FencedCode") {
        const code = mermaidCode(state, node.node);
        if (code === null) return false;
        if (touchesSelection(state, node.from, node.to)) return false;
        out.push(
          Decoration.replace({
            widget: new MermaidWidget(code, theme),
            block: true,
          }).range(node.from, node.to),
        );
        return false;
      }
      // ブロックはトップレベル。中まで潜る必要は無い
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return out;
}

/// 数式ブロックと図。**表と分けてある** — 表は編集の近さで間引く仕組みを
/// 持つが、こちらは素直に数え直すほうが確かで、数も少ない。
export const blockWidgetField = StateField.define<DecorationSet>({
  create: (state) => RangeSet.of(blockWidgetDecorations(state), true),
  update(value, tr) {
    const modeChanged = tr.effects.some((e) => e.is(setSourceMode));
    const themeChanged = tr.effects.some((e) => e.is(setDiagramTheme));
    // 解析の進みも見る（表と同じ理由）
    const treeGrew = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    if (
      !tr.docChanged &&
      !tr.selection &&
      !modeChanged &&
      !themeChanged &&
      !treeGrew
    ) {
      return value;
    }
    return RangeSet.of(blockWidgetDecorations(tr.state), true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const tableField = StateField.define<DecorationSet>({
  create: computeTableSet,
  update(value, tr) {
    const modeChanged = tr.effects.some((e) => e.is(setSourceMode));
    // **解析が進んだら数え直す。** 長いノートは開いた時点では途中までしか
    // 解析されておらず、下のほうの表は**まだ木に無い**。スクロールで
    // 解析が進んだことは docChanged にも selection にも出ないので、
    // これを見ないと表が生のまま残る（実機で発覚 2026-09-04）
    const treeGrew = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    if (!tr.docChanged && !tr.selection && !modeChanged && !treeGrew) {
      return value;
    }
    if (modeChanged) return computeTableSet(tr.state);
    if (treeGrew && !tr.docChanged) return computeTableSet(tr.state);
    const meta = tableMeta.get(value);
    if (!meta) return computeTableSet(tr.state);

    if (tr.docChanged) {
      if (editNearTables(tr)) return computeTableSet(tr.state);
      // 表に関わらない編集: 位置だけ写像して使い回す
      const zones = meta.zones.map((zone) => ({
        from: tr.changes.mapPos(zone.from, 1),
        to: tr.changes.mapPos(zone.to, -1),
      }));
      const revealKey = revealKeyOf(tr.state, zones);
      if (revealKey !== meta.revealKey) return computeTableSet(tr.state);
      const mapped = value.map(tr.changes);
      tableMeta.set(mapped, { zones, revealKey });
      return mapped;
    }
    // カーソル移動のみ: リビール状態が変わったときだけ再計算
    const revealKey = revealKeyOf(tr.state, meta.zones);
    if (revealKey !== meta.revealKey) return computeTableSet(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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
      // 表と同じ理由で**解析の進みも見る**（画面を動かさないまま解析が
      // 追いついたとき、装飾が掛からないまま残る）
      const treeGrew =
        syntaxTree(update.state) !== syntaxTree(update.startState);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        modeChanged ||
        treeGrew
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
const blockTheme = EditorView.baseTheme({
  // `:::note` の囲み（B-3）。実色は App.css の CSS 変数が持つ
  // （ライト / ダークを 1 か所で切り替えるため）
  ".cm-note-line": {
    paddingLeft: "10px",
    borderLeft: "3px solid var(--note-line, currentColor)",
    backgroundColor: "var(--note-bg, transparent)",
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
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
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
  ".cm-code-filename": {
    display: "inline-block",
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: "0.75em",
    padding: "0.1em 0.7em",
    borderRadius: "4px",
    // 参照実装 code_name_background / foreground（ADR-0008）。
    // 実色は App.css の変数（ライト #63636B / ダーク #5A5A63 に白系文字）
    backgroundColor: "var(--code-name-bg, #63636b)",
    color: "var(--code-name-fg, #ffffff)",
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
  tableField,
  blockWidgetField,
  syntaxHighlighting(style),
  blockTheme,
];
