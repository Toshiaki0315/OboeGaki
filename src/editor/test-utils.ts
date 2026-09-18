// エディタのテストの足場。**本番と同じ構文木**（`markdownConfig()`）で状態を作る。
// 以前は 24 ファイルが各自 `markdown({ extensions: [...] })` を持っていて、本番の
// 設定（コードの入れ子・IndentedCode の扱い）と乖離しうる形だった（19-1。2026-09-18）。
// テストだけが読む。本番のコードから import しないこと

import {
  EditorState,
  type Extension,
  type StateCommand,
} from "@codemirror/state";
import { markdownConfig } from "./extensions";

/// 本番と同じ Markdown の解析
export const LANG: Extension = markdownConfig();

/// 文書とカーソル位置から状態を作る（拡張は既定で LANG だけ）
export function stateOf(
  doc: string,
  anchor = 0,
  extensions: Extension = LANG,
): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions });
}

/// `｜` の位置にカーソルを置いてコマンドを実行する。
/// 対象外（false）なら null、実行されたら結果の文書（新カーソル位置に ｜）
export function press(
  command: StateCommand,
  docWithCursor: string,
  extensions: Extension = LANG,
): string | null {
  const anchor = docWithCursor.indexOf("｜");
  if (anchor < 0) throw new Error("カーソル記号 ｜ が無い");
  const doc = docWithCursor.replace("｜", "");
  const state = stateOf(doc, anchor, extensions);
  let result: string | null = null;
  const handled = command({
    state,
    dispatch(tr) {
      const head = tr.newSelection.main.head;
      const text = tr.newDoc.toString();
      result = text.slice(0, head) + "｜" + text.slice(head);
    },
  });
  return handled ? result : null;
}
