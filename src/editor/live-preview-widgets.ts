// ライブプレビューの widget（DOM を触るのはここだけ。T3）。点・チェックボックス・
// 数式・図・画像・表・ファイル名・水平線・Setext の線。19-2 で live-preview.ts から分けた

import { EditorView, WidgetType } from "@codemirror/view";
import { Facet } from "@codemirror/state";
import { clampImageWidth, withImageWidth } from "./image-size";
import { svgFromDataUrl, svgNaturalSize } from "../lib/svg-png";
import { renderMermaid, type MermaidTheme } from "./mermaid";

import { CellSegment, TableData } from "./live-preview-table-data";

/// 箇条書きの点。深さで描き分ける（ADR-0026 の ● ○ ■）。
export function bulletGlyph(depth: number): string {
  const glyphs = ["●", "○", "■"];
  return glyphs[((depth % 3) + 3) % 3];
}

/// 点の大きさ。**幅とぶら下げ幅は同じ値から出す。** 点は小さい字（0.7em）で
/// 描くので、その中の 1.2em は行の字では 1.2 × 0.7 = 0.84em。ぶら下げ幅を
/// 行の字で 1.2em と取ると、折り返しが半字ぶん右へずれる（実機 2026-09-10）
export const BULLET_FONT_SCALE = 0.7;
export const BULLET_WIDTH_EM = 1.2;
/// 行の字で測った点の幅（ぶら下げ幅に使う）
export const BULLET_HANG = `${(BULLET_WIDTH_EM * BULLET_FONT_SCALE).toFixed(2)}em`;

export class BulletWidget extends WidgetType {
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

/// 折りたたみの見出し（6-2）。`:::details 呼び名` の行をこれに差し替える。
export class SummaryWidget extends WidgetType {
  constructor(readonly summary: string) {
    super();
  }
  eq(other: SummaryWidget): boolean {
    return other.summary === this.summary;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-details-summary";
    span.textContent = this.summary;
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export class CheckboxWidget extends WidgetType {
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
export class MathWidget extends WidgetType {
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
export class MermaidWidget extends WidgetType {
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
export const REMOTE_RE = /^(https?:|data:)/i;

/// 本文の画像。`![説明](…)` の説明は画像の下にキャプションとして出し、
/// 載せたときの Tip にも入れる（要望 2026-09-08。PPTX 書き出しの「画像の
/// 下に説明を出す」と同じ見せ方）。テストのために export する。
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return (
      other.url === this.url &&
      other.alt === this.alt &&
      other.width === this.width &&
      other.height === this.height
    );
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
      image.title = this.alt; // 載せたときの Tip
      // 大きさ指定（6-8）。**幅だけのときは縦を自動に**（形が崩れない）
      if (this.width !== undefined) {
        image.style.width = `${this.width}px`;
        image.style.height =
          this.height === undefined ? "auto" : `${this.height}px`;
      } else {
        // 幅の無い SVG（draw.io や Excalidraw の書き出し）は viewBox の
        // 大きさで置く。何もしないと 300×150 に潰れる（要望 2026-09-09）。
        // max-width: 100% が効くので、欄より広くはならない
        const svg = svgFromDataUrl(src);
        const natural = svg === null ? null : svgNaturalSize(svg);
        if (natural) {
          image.style.width = `${natural.width}px`;
          image.style.height = "auto";
        }
      }
      // 絵とつまみを 1 つの枠に入れる（つまみは絵の右下に重ねる。説明が
      // 下に付いても、説明の上ではなく絵の上に出る）
      const frame = document.createElement("span");
      frame.className = "cm-image-frame";
      frame.append(image, this.resizeHandle(view, image));
      if (this.alt) {
        const caption = document.createElement("span");
        caption.className = "cm-image-caption";
        caption.textContent = this.alt;
        holder.replaceChildren(frame, caption);
      } else {
        holder.replaceChildren(frame);
      }
      // 画像の高さが後から確定するので、行レイアウトを測り直させる
      view.requestMeasure();
    });
    return holder;
  }

  /// 絵の右下のつまみ（6-8b。要望 2026-09-15）。引いている間は絵だけが
  /// 先に変わり、**離したときに本文の `|幅` を書き換える**（真実は本文 = T1。
  /// 書き出しにもそのまま効く）。幅だけ書き、縦は形なりに縮ませる
  private resizeHandle(view: EditorView, image: HTMLImageElement): HTMLElement {
    const handle = document.createElement("span");
    handle.className = "cm-image-resize";
    handle.title = "引いて大きさを変える";
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      // エディタに渡すと行にカーソルが入ってソースが現れ、引いている最中に
      // 絵そのものが消える。ここで止める（ignoreEvent でも弾く）
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth =
        image.getBoundingClientRect().width || this.width || image.naturalWidth;
      if (!startWidth) return;
      let width = startWidth;
      handle.classList.add("dragging");
      const move = (moved: MouseEvent) => {
        width = clampImageWidth(startWidth + (moved.clientX - startX));
        image.style.width = `${width}px`;
        image.style.height = "auto";
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        handle.classList.remove("dragging");
        if (width === startWidth) return; // 動かしていない
        const line = view.state.doc.lineAt(view.posAtDOM(handle));
        const next = withImageWidth(line.text, width);
        if (next === line.text) return;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: next },
        });
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    return handle;
  }

  ignoreEvent(event: Event): boolean {
    // つまみの上だけはエディタに渡さない。ほかはクリックでカーソルが行へ
    // 入り、ソースが現れる（今までどおり）
    return (
      event.target instanceof Element &&
      event.target.closest(".cm-image-resize") !== null
    );
  }
}

export class TableWidget extends WidgetType {
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
export class FileNameWidget extends WidgetType {
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

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-hr-widget";
    return rule;
  }
}

/// Setext 見出し（`題\n===`）の下線。`===` を隠すだけだと下線の行が空の 1 行
/// として残るので、細い線として描く（2026-09-17 に決めた）。テストは `rule` で見分ける
export class SetextRuleWidget extends WidgetType {
  readonly rule = true;
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-setext-rule";
    return rule;
  }
}
