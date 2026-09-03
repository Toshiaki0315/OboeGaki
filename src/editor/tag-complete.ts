// タグ補完（C-4 / H-3）。参照実装 core/tags.py の `prefix_at` / `matches` を
// そのまま移植し、CM6 の autocompletion に載せる。
//
// 候補の出し入れ・↑↓ / Enter の選択は @codemirror/autocomplete が持つ。
// **変換中は出さない**（T5 / 参照実装 R6）。確定前に一覧が出ると変換候補と
// 重なる。CM6 は変換中も input.type のトランザクションを流すので、補完側で
// 明示的に見送る（変換の確定後は CM6 が補完を掛け直す）。

import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

/// その位置で打ちかけているタグ。タグの外なら null。
///
/// **カーソルより後ろは見ない。** `#日報メモ` の途中に居るときは、打った分
/// （`日`）で絞る。後ろまで含めると、直そうとしている綴りで絞ってしまう。
export function tagPrefixAt(line: string, column: number): string | null {
  const head = line.slice(0, column);
  const hash = head.lastIndexOf("#");
  if (hash < 0) return null;
  // 直前は行頭か空白（URL の `#anchor` を拾わない）。tags.rs と同じ規則
  if (hash > 0 && !/\s/.test(head[hash - 1])) return null;
  const name = head.slice(hash + 1);
  if (/[\s#]/.test(name)) return null;
  return name;
}

/// 前方一致で候補を絞る。大文字小文字は区別しない。
///
/// **打ったものと同じだけの候補は返さない。** 選ぶものが無いのに一覧が
/// 出ていると、Enter がタグの決定なのか改行なのか分からなくなる。
export function matchTags(prefix: string, known: string[]): string[] {
  const lowered = prefix.toLowerCase();
  const found = known.filter((tag) => tag.toLowerCase().startsWith(lowered));
  if (found.length === 1 && found[0] === prefix) return [];
  return found;
}

/// コードの中か（フェンスもインラインコードも）。索引の tags.rs / wikilink.rs
/// はコードを走査しないので、そこで候補を出しても選んだ先に何も生まれない。
export function insideCode(context: CompletionContext, pos: number): boolean {
  for (
    let node = syntaxTree(context.state).resolveInner(pos, -1);
    node;
    node = node.parent as typeof node
  ) {
    if (/Code|Fence/.test(node.name)) return true;
  }
  return false;
}

/// `#` を打っている間だけ候補を出す補完ソース。既知のタグは呼ぶたびに
/// 取り直す（索引が更新されれば次の打鍵から新しいタグが出る）。
export function tagCompletion(
  knownTags: () => string[],
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.view?.composing) return null; // 変換中（T5）
    const line = context.state.doc.lineAt(context.pos);
    const prefix = tagPrefixAt(line.text, context.pos - line.from);
    if (prefix === null) return null;
    if (insideCode(context, context.pos)) return null;
    const options = matchTags(prefix, knownTags());
    if (options.length === 0) return null;
    return {
      from: context.pos - prefix.length, // `#` は残して名前だけ置き換える
      options: options.map((tag) => ({ label: tag, type: "keyword" })),
      // 名前を打ち進めている間は同じ候補集合を絞るだけで済む
      validFor: /^[^\s#]*$/,
    };
  };
}
