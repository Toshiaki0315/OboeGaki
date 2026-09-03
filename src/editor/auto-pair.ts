// オートペアと URL 貼り付けリンク化（TASKS 1-4、spec §5.5-4/5）。
//
// 選択があるときに `*` `[` `(` `"` `` ` `` を打つと、選択を消さずに囲む。
// 選択があるときに URL を貼ると `[選択](URL)` にする。
// どちらも「選択が無ければ何もしない」— 普段の入力を邪魔しない。

import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertLink, type Replacement } from "./format-commands";

export const AUTO_PAIRS: Record<string, string> = {
  "*": "*",
  "`": "`",
  "[": "]",
  "(": ")",
  '"': '"',
};

/// 選択 `[start, end)` を対で囲む。選択が無い・対が無い文字なら null。
/// 続けて押せば強調を二重にできるよう、中身を選んだままにする。
export function wrapPair(
  text: string,
  start: number,
  end: number,
  opening: string,
): Replacement | null {
  const closing = AUTO_PAIRS[opening];
  if (!closing || start === end) return null;
  const selected = text.slice(start, end);
  return {
    start,
    end,
    text: `${opening}${selected}${closing}`,
    selectStart: start + opening.length,
    selectEnd: start + opening.length + selected.length,
  };
}

/// 全選択範囲を対で囲む transaction を作る。囲む対象が無ければ null。
export function wrapSelections(
  state: EditorState,
  opening: string,
): TransactionSpec | null {
  if (!(opening in AUTO_PAIRS)) return null;
  if (state.selection.ranges.every((range) => range.empty)) return null;
  return state.changeByRange((range) => {
    const replacement = wrapPair(
      state.doc.toString(),
      range.from,
      range.to,
      opening,
    );
    if (!replacement) {
      // 複数選択の中の空カーソルには、打った文字をそのまま入れる
      return {
        changes: { from: range.from, insert: opening },
        range: EditorSelection.cursor(range.from + opening.length),
      };
    }
    return {
      changes: {
        from: replacement.start,
        to: replacement.end,
        insert: replacement.text,
      },
      range: EditorSelection.range(
        replacement.selectStart,
        replacement.selectEnd,
      ),
    };
  });
}

/// 貼り付けの中身が URL とみなせるか（spec §5.5-5）。
const URL_RE = /^\s*[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+\s*$/;

export function isUrl(text: string): boolean {
  return URL_RE.test(text);
}

/// 選択中に対の文字を打ったら囲む。IME 変換中は何もしない（T5）。
export const autoPair = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (view.composing) return false;
  const spec = wrapSelections(view.state, text);
  if (!spec) return false;
  view.dispatch({ ...spec, userEvent: "input.type" });
  return true;
});

/// 選択中に URL を貼ったらリンクにする。
export const urlPasteLink = EditorView.domEventHandlers({
  paste: (event, view) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const { main } = view.state.selection;
    if (main.empty || !isUrl(text)) return false;
    event.preventDefault();
    const replacement = insertLink(
      view.state.doc.toString(),
      main.from,
      main.to,
      text.trim(),
    );
    view.dispatch({
      changes: {
        from: replacement.start,
        to: replacement.end,
        insert: replacement.text,
      },
      selection: EditorSelection.range(
        replacement.selectStart,
        replacement.selectEnd,
      ),
      userEvent: "input.paste",
    });
    return true;
  },
});
