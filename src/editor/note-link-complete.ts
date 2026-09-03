// `[[ノート名]]` の補完（E-6）。参照実装 core/notelink.py の移植。
//
// 書けるのに候補が出ないと、正確な名前を覚えているか、別のノートを開いて
// 確かめることになる。**絞りの規則はタグ補完と同じもの**（matchTags）を
// 使う — 「打ったものと同じだけなら出さない」という Enter の解釈に関わる
// 規則が 2 か所にあると、片方だけ直されて挙動がずれる。

import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { matchTags, insideCode } from "./tag-complete";

/// その位置で打ちかけているノート名。リンクの外なら null。
///
/// **閉じていないものだけ**を拾う。名前に `[` `]` `|` と改行は入らない
/// （別名の記法 `[[名前|表示]]` は未対応で、中途半端に補完すると名前が壊れる）。
/// **カーソルより後ろは見ない**（タグ補完と同じ考え方）。
export function noteLinkPrefixAt(line: string, column: number): string | null {
  const head = line.slice(0, column);
  const open = head.lastIndexOf("[[");
  if (open < 0) return null;
  const name = head.slice(open + 2);
  if (/[[\]|]/.test(name)) return null;
  // `[[[名前` のような打ち間違いで名前を伸ばさない
  if (head[open - 1] === "[") return null;
  return name;
}

/// カーソル位置から閉じ `]]` までに残っている名前の長さ。
/// 閉じが無ければ null（開きかけのリンク。行の残りは名前ではないので
/// 食べてはいけない）。
export function closingTail(rest: string): number | null {
  const found = /^([^[\]|\n]*)\]\]/.exec(rest);
  return found ? found[1].length : null;
}

/// 候補を確定したときの書き換え。閉じた `[[…]]` の中で確定したら、
/// **閉じまでの残りの名前ごと**置き換える（カーソル直後の 2 文字だけを見る
/// 判定だと、名前の途中で `[[会議メモ]]モ]]` に壊れる）。
export function linkCompletionEdit(
  rest: string,
  label: string,
  from: number,
  pos: number,
): { from: number; to: number; insert: string; anchor: number } {
  const tail = closingTail(rest);
  if (tail === null) {
    // 開きかけ。閉じはこちらで足す
    const insert = `${label}]]`;
    return { from, to: pos, insert, anchor: from + insert.length };
  }
  // 既にある閉じ `]]` は残し、その外へ出る（続けて書けるように）
  return {
    from,
    to: pos + tail,
    insert: label,
    anchor: from + label.length + 2,
  };
}

/// `[[` を打っている間だけ候補を出す補完ソース。
export function noteLinkCompletion(
  knownTitles: () => string[],
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.view?.composing) return null; // 変換中（T5）
    const line = context.state.doc.lineAt(context.pos);
    const column = context.pos - line.from;
    const prefix = noteLinkPrefixAt(line.text, column);
    if (prefix === null) return null;
    if (insideCode(context, context.pos)) return null;
    const options = matchTags(prefix, knownTitles());
    if (options.length === 0) return null;
    const from = context.pos - prefix.length;
    const rest = line.text.slice(column);
    const apply = (view: EditorView, completion: Completion) => {
      const edit = linkCompletionEdit(
        rest,
        completion.label,
        from,
        context.pos,
      );
      view.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.anchor },
        userEvent: "input.complete",
      });
    };
    return {
      from,
      options: options.map((title) => ({ label: title, type: "text", apply })),
      validFor: /^[^[\]|\n]*$/,
    };
  };
}
