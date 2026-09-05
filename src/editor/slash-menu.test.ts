// `/` の候補メニュー（TASKS 6-1、要望 2026-09-05）。

import { describe, expect, test } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  matchSlash,
  slashCompletion,
  slashPrefixAt,
  SLASH_COMMANDS,
} from "./slash-menu";

describe("slashPrefixAt", () => {
  test("test_行頭の / の直後は空文字（そこで全部の候補を出す）", () => {
    expect(slashPrefixAt("/", 1)).toBe("");
  });

  test("test_打ちかけの言葉を返す", () => {
    expect(slashPrefixAt("/cod", 4)).toBe("cod");
  });

  test("test_行に続きがあるときは出さない", () => {
    // `/usr/local/bin` を打っている途中に候補を出さない
    expect(slashPrefixAt("/usr/local", 4)).toBeNull();
  });

  test("test_行頭でない / は候補にしない（日付・URL）", () => {
    expect(slashPrefixAt("2026/09", 7)).toBeNull();
    expect(slashPrefixAt("見出し /co", 6)).toBeNull();
  });

  test("test_空白を挟んだら終わり", () => {
    expect(slashPrefixAt("/code block", 11)).toBeNull();
  });
});

describe("SLASH_COMMANDS", () => {
  test("test_呼び名も説明も入れるものもある", () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.label, command.id).not.toBe("");
      expect(command.hint, command.id).not.toBe("");
      expect(command.snippet, command.id).not.toBe("");
    }
  });

  test("test_同じ言葉を 2 つ置かない", () => {
    const ids = SLASH_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("test_AI に本文を書かせる候補は置かない", () => {
    // アシスタントは「本文は書き換えません」と画面で約束している
    expect(SLASH_COMMANDS.map((command) => command.id)).not.toContain(
      "aisuggest",
    );
    for (const command of SLASH_COMMANDS) {
      expect(`${command.label} ${command.hint}`, command.id).not.toContain(
        "AI",
      );
    }
  });

  test("test_折りたたみは覚書の記法で入れる（生の HTML は書かせない）", () => {
    const details = SLASH_COMMANDS.find((command) => command.id === "details");
    expect(details?.snippet).toContain(":::details");
    expect(details?.snippet).not.toContain("<details>");
  });

  test("test_囲みは覚書の記法で入れる", () => {
    const alert = SLASH_COMMANDS.find((command) => command.id === "alert");
    expect(alert?.snippet).toContain(":::note alert");
  });
});

describe("matchSlash", () => {
  test("test_打っていなければ全部出す", () => {
    expect(matchSlash("")).toEqual([...SLASH_COMMANDS]);
  });

  test("test_前方一致で絞る（大文字小文字は区別しない）", () => {
    expect(matchSlash("CODE").map((command) => command.id)).toContain("code");
  });

  test("test_日本語の呼び名でも絞れる", () => {
    // 変換を確定したあとに絞り込める（英語の綴りを覚えなくてよい）
    expect(matchSlash("表").map((command) => command.id)).toContain("table");
  });

  test("test_無ければ空", () => {
    expect(matchSlash("zzz")).toEqual([]);
  });
});

function complete(doc: string, pos: number, composing = false) {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
  const view = { composing } as unknown as EditorView;
  return slashCompletion()(new CompletionContext(state, pos, false, view));
}

describe("slashCompletion", () => {
  test("test_/ ごと置き換える範囲と候補を返す", () => {
    const doc = "# 題\n\n/cod";
    const result = complete(doc, doc.length);
    expect(result?.from).toBe(doc.indexOf("/cod")); // `/` も消す
    expect(result?.options.map((option) => option.label)).toEqual(["code"]);
  });

  test("test_選ぶと / ごと置き換わる（打った印を本文に残さない）", () => {
    const doc = "# 題\n\n/cod";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
    });
    const result = complete(doc, doc.length)!;
    const option = result.options[0];
    let after = state;
    const apply = option.apply as (
      editor: { state: EditorState; dispatch: (tr: Transaction) => void },
      completion: typeof option,
      from: number,
      to: number,
    ) => void;
    apply(
      {
        state,
        dispatch: (tr) => {
          after = tr.state;
        },
      },
      option,
      result.from,
      doc.length,
    );
    expect(after.doc.toString()).toBe("# 題\n\n```\n\n```");
  });

  test("test_絞り込みは自分でやる（CM6 に任せると候補が全部消える）", () => {
    // CM6 は `from` から今の位置までの文字で候補の呼び名を絞る。ここは
    // `/cod` なので、**`/` がどの呼び名にも入っていない**ぶん 1 つも
    // 残らない = メニューが出ない（実機で発覚 2026-09-05）。
    // `filter: false` にして、絞り込みは matchSlash が持つ
    const doc = "# 題\n\n/cod";
    const result = complete(doc, doc.length)!;
    expect(result.filter).toBe(false);
    expect(doc.slice(result.from)).toBe("/cod");
    // 絞り込みを自分でやる以上、**打つたびに問い合わせ直す**必要がある
    // （validFor を置くと、前の候補をそのまま使い回して絞られない）
    expect(result.validFor).toBeUndefined();
  });

  test("test_変換中は出さない（T5）", () => {
    expect(complete("/co", 3, true)).toBeNull();
  });

  test("test_コードの中では出さない", () => {
    const fenced = "```sh\n/co";
    expect(complete(fenced, fenced.length)).toBeNull();
  });

  test("test_候補が無ければ出さない", () => {
    const doc = "/zzz";
    expect(complete(doc, doc.length)).toBeNull();
  });
});
