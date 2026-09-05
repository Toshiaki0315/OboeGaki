// コードブロックのコピー（要望 2026-09-06。Qiita と同じ入口）。
//
// マウスがブロックに入っている間だけ、右上に印を出す。押すと**中身だけ**を
// クリップボードに入れる（``` と言語名は写さない — 貼る先で邪魔になる）。
//
// **印は state から作る**（ViewPlugin ではなく facet で計算する）。この
// アプリではブロックの形を変える装飾を plugin から出すと CM6 が投げる
// （ADR-0035）。ここは行の中の widget なので投げないが、置き場所を揃える。

import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { treeOf } from "./parse-tree";

export type CodeBlock = {
  /// ブロック全体（開きの行頭から閉じの行末まで）。
  from: number;
  to: number;
  /// 印を置く場所（先頭の行末）。
  markAt: number;
  /// 写す中身（前後の ``` と言語名を除いたもの）。
  code: string;
};

/// その位置を含むコードブロック。フェンスの外・中身が空なら null。
export function codeBlockAt(state: EditorState, pos: number): CodeBlock | null {
  let node = treeOf(state, Math.min(pos + 1, state.doc.length)).resolveInner(
    Math.min(pos, state.doc.length),
    1,
  );
  while (node.parent && node.name !== "FencedCode") node = node.parent;
  if (node.name !== "FencedCode") return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  // 中身は開きの次の行から、閉じの手前の行まで。閉じが無ければ末尾まで
  const closed =
    last.from > first.to && last.text.trimStart().startsWith("```");
  const bodyFrom = first.to + 1;
  const bodyTo = closed ? last.from - 1 : node.to;
  if (bodyTo <= bodyFrom) return null; // 空のブロックは写すものが無い
  const code = state.sliceDoc(bodyFrom, bodyTo).replace(/\n+$/, "");
  if (!code.trim()) return null;
  return { from: node.from, to: node.to, markAt: first.to, code };
}

/// マウスが入っているブロックの位置（外へ出たら null）。
export const setHoveredCode = StateEffect.define<number | null>();

const hoveredCode = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoveredCode)) return effect.value;
    }
    if (value === null) return null;
    return tr.docChanged ? tr.changes.mapPos(value, 1) : value;
  },
});

class CopyCodeWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }
  eq(other: CopyCodeWidget): boolean {
    return other.code === this.code;
  }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "cm-copy-code";
    button.type = "button";
    button.title = "コードをコピー";
    button.setAttribute("aria-label", "コードをコピー");
    button.append(icon());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void navigator.clipboard
        ?.writeText(this.code)
        .then(() => {
          // **写せたことを見せる。** 押した手応えが無いと、何度も押す
          button.classList.add("copied");
          button.title = "コピーしました";
          setTimeout(() => {
            button.classList.remove("copied");
            button.title = "コードをコピー";
          }, 1200);
        })
        .catch(() => {
          button.title = "コピーできませんでした";
        });
    });
    return button;
  }
  ignoreEvent(): boolean {
    return true; // 押してもキャレットは動かさない（写すだけの道具）
  }
}

function icon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of [
    "M5.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z",
    "M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

const copyDecorations = EditorView.decorations.compute(
  [hoveredCode, "doc"],
  (state): DecorationSet => {
    const pos = state.field(hoveredCode, false);
    if (pos === null || pos === undefined) return Decoration.none;
    const block = codeBlockAt(state, pos);
    if (!block) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new CopyCodeWidget(block.code),
        side: 1,
      }).range(block.markAt),
    ]);
  },
);

/// どのブロックの上に居るかを追う。**行をまたいだときだけ**知らせる
/// （mousemove のたびに transaction を流すと打鍵の邪魔になる）。
const followMouse = EditorView.domEventHandlers({
  mouseover(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const block = pos === null ? null : codeBlockAt(view.state, pos);
    const now = block ? block.markAt : null;
    const before = view.state.field(hoveredCode, false) ?? null;
    const same =
      before !== null &&
      block !== null &&
      before >= block.from &&
      before <= block.to;
    if (same || before === now) return false;
    view.dispatch({ effects: setHoveredCode.of(block ? pos : null) });
    return false;
  },
  mouseleave(_event, view) {
    if (view.state.field(hoveredCode, false) === null) return false;
    view.dispatch({ effects: setHoveredCode.of(null) });
    return false;
  },
});

export const copyCode = [hoveredCode, copyDecorations, followMouse];
