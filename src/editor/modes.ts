// フォーカスモードとタイプライタモード（spec §5.4 の Cmd+Shift+D / Y）。
//
// - フォーカス: 現在段落（トップレベルのブロック）以外の行を減光する
// - タイプライタ: キャレット行を画面の中央に保つ
//
// どちらも文書には一切触れない（行クラスとスクロールだけ）。

import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

function toggleField(
  effect: StateEffect<boolean> extends never
    ? never
    : ReturnType<typeof StateEffect.define<boolean>>,
) {
  return StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
      let next = value;
      for (const found of tr.effects) {
        if (found.is(effect)) next = found.value;
      }
      return next;
    },
  });
}

export const setFocusMode = StateEffect.define<boolean>();
export const focusModeField = toggleField(setFocusMode);

export const setTypewriter = StateEffect.define<boolean>();
export const typewriterField = toggleField(setTypewriter);

/// キャレットのある「段落」（トップレベルのブロック）の範囲。
/// 空行の上では null（減光しない）。
export function focusRange(
  state: EditorState,
): { start: number; end: number } | null {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!line.text.trim()) return null;
  // トップレベル（Document 直下）のブロックまで上がる
  let node = syntaxTree(state).resolveInner(head, -1);
  while (node.parent && node.parent.name !== "Document") {
    node = node.parent;
  }
  if (node.name === "Document") return null;
  return { start: node.from, end: node.to };
}

/// フォーカスモード中、現在段落の外の行を減光する。
const focusDim = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      const toggled = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setFocusMode)),
      );
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        toggled
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      if (!view.state.field(focusModeField, false)) return Decoration.none;
      const keepAlight = focusRange(view.state);
      const out: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const inFocus =
            keepAlight !== null &&
            line.to >= keepAlight.start &&
            line.from <= keepAlight.end;
          if (!inFocus && keepAlight !== null) {
            out.push(
              Decoration.line({ class: "cm-dim-line" }).range(line.from),
            );
          }
          if (line.to >= to) break;
          pos = line.to + 1;
        }
      }
      return RangeSet.of(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/// タイプライタモード中、キャレット移動のたびに行を中央へ寄せる。
const typewriterScroll = EditorView.updateListener.of((update) => {
  if (!update.state.field(typewriterField, false)) return;
  if (!update.selectionSet && !update.docChanged) return;
  const head = update.state.selection.main.head;
  // updateListener の中から直接 dispatch しない（再入になる）
  queueMicrotask(() => {
    update.view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
  });
});

function toggle(effect: typeof setFocusMode) {
  return (view: EditorView) => {
    const field = effect === setFocusMode ? focusModeField : typewriterField;
    view.dispatch({ effects: effect.of(!view.state.field(field)) });
    return true;
  };
}

const dimTheme = EditorView.baseTheme({
  ".cm-dim-line": { opacity: "0.3", transition: "opacity 0.15s" },
});

export const editorModes = [
  focusModeField,
  typewriterField,
  focusDim,
  typewriterScroll,
  dimTheme,
  keymap.of([
    { key: "Mod-Shift-d", run: toggle(setFocusMode) },
    { key: "Mod-Shift-y", run: toggle(setTypewriter) },
  ]),
];
