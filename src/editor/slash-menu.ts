// `/` の候補メニュー（TASKS 6-1、要望 2026-09-05）。
//
// 空行で `/` を打つと、覚書の記法が候補で出る。**並べるのは既にある機能への
// 近道だけ** — 新しい書き方は増やさない。AI に本文を書かせる候補は置かない
// （アシスタントは「本文は書き換えません」と画面で約束している）。
//
// 候補の出し入れ・↑↓ / Enter の選択・スニペットの穴埋めは
// @codemirror/autocomplete が持つ。ここは「いつ出すか」と「何を出すか」だけ。

import {
  snippetCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { insideCode } from "./tag-complete";

export type SlashCommand = {
  /// 打って絞るための言葉（Qiita と同じ綴りに寄せる）。
  id: string;
  /// 画面に出す呼び名。
  label: string;
  /// 何をするか（1 行）。
  hint: string;
  /// 入れるもの。`${}` はカーソルの止まる場所（CM6 のスニペット）。
  snippet: string;
};

/// 出す順は**よく使うものが上**。Qiita の並びに寄せてある。
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "code",
    label: "コードブロック",
    hint: "```  で囲んだコードを入れます",
    snippet: "```${}\n\n```",
  },
  {
    id: "alert",
    label: "警告の囲み",
    hint: "赤い囲みを入れます",
    snippet: ":::note alert\n${}\n:::",
  },
  {
    id: "warn",
    label: "注意の囲み",
    hint: "黄色い囲みを入れます",
    snippet: ":::note warn\n${}\n:::",
  },
  {
    id: "info",
    label: "補足の囲み",
    hint: "緑の囲みを入れます",
    snippet: ":::note info\n${}\n:::",
  },
  {
    id: "details",
    label: "折りたたみ",
    hint: "畳んでおける囲みを入れます",
    snippet: ":::details ${呼び名}\n${}\n:::",
  },
  {
    id: "table",
    label: "表",
    hint: "2 列 2 行の表を入れます",
    snippet: "| ${見出し} | 見出し |\n|:--|:--|\n|  |  |\n|  |  |",
  },
  {
    id: "quote",
    label: "引用",
    hint: "引用を入れます",
    snippet: "> ${}",
  },
  {
    id: "checklist",
    label: "チェックリスト",
    hint: "チェックの付く箇条書きを入れます",
    snippet: "- [ ] ${}",
  },
  {
    id: "math",
    label: "数式",
    hint: "$$ で囲んだ数式を入れます",
    snippet: "$$\n${}\n$$",
  },
  {
    id: "mermaid",
    label: "図（Mermaid）",
    hint: "文で描く図を入れます",
    snippet: "```mermaid\n${flowchart TD}\n```",
  },
  {
    id: "footnote",
    label: "脚注",
    hint: "脚注の印と、その中身を入れます",
    snippet: "[^${1}]\n\n[^${1}]: ${0}",
  },
];

// **行頭の `/` だけ。** 日付（2026/09/05）・URL・and/or で誤爆させない
const SLASH_RE = /^\/(\S*)$/;

/// その位置で打ちかけている言葉。候補を出す場所でなければ null。
///
/// **行に続きがあるときは出さない** — `/usr/local/bin` を打っている途中に
/// メニューが出ると、打鍵の邪魔にしかならない。
export function slashPrefixAt(line: string, column: number): string | null {
  if (line.slice(column).trim()) return null;
  const found = SLASH_RE.exec(line.slice(0, column));
  return found ? found[1] : null;
}

/// 打った言葉で絞る。**英語の綴りでも日本語の呼び名でも引ける** —
/// 綴りを覚えていなくても「表」で表に辿り着ける。
export function matchSlash(
  prefix: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  if (!prefix) return [...commands];
  const lowered = prefix.toLowerCase();
  return commands.filter(
    (command) =>
      command.id.toLowerCase().startsWith(lowered) ||
      command.label.includes(prefix),
  );
}

/// 行頭で `/` を打っている間だけ候補を出す補完ソース。
export function slashCompletion(
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.view?.composing) return null; // 変換中（T5）
    const line = context.state.doc.lineAt(context.pos);
    const prefix = slashPrefixAt(line.text, context.pos - line.from);
    if (prefix === null) return null;
    if (insideCode(context, context.pos)) return null;
    const found = matchSlash(prefix, commands);
    if (found.length === 0) return null;
    return {
      // **`/` ごと置き換える。** 打った印を本文に残さない
      from: line.from,
      options: found.map((command) =>
        snippetCompletion(command.snippet, {
          label: command.id,
          detail: `${command.label} — ${command.hint}`,
          type: "keyword",
        }),
      ),
      // 打ち進めている間は同じ候補集合を絞るだけで済む
      validFor: /^\/\S*$/,
    };
  };
}
