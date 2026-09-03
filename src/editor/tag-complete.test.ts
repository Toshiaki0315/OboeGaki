// タグ補完（C-4 / H-3、参照実装 core/tags.py の prefix_at・matches の移植）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { matchTags, tagCompletion, tagPrefixAt } from "./tag-complete";

describe("tagPrefixAt", () => {
  test("打ちかけのタグを返す", () => {
    expect(tagPrefixAt("本文の #日報", 7)).toBe("日報");
  });

  test("カーソルより後ろは見ない（直そうとしている綴りで絞らない）", () => {
    // `#日報メモ` の `日` の直後。打った分だけで絞る
    expect(tagPrefixAt("#日報メモ", 2)).toBe("日");
  });

  test("`#` の直後は空文字（そこで全部の候補を出す）", () => {
    expect(tagPrefixAt("本文の #", 5)).toBe("");
  });

  test("直前が非空白ならタグではない（URL の #anchor）", () => {
    expect(tagPrefixAt("https://example.com/#anc", 24)).toBeNull();
  });

  test("タグの外なら null", () => {
    expect(tagPrefixAt("ただの本文", 3)).toBeNull();
    expect(tagPrefixAt("#日報 のあと", 6)).toBeNull(); // 空白を挟んだら終わり
  });

  test("直前のタグに引きずられない", () => {
    expect(tagPrefixAt("#日報 と #会", 8)).toBe("会");
  });
});

describe("matchTags", () => {
  const known = ["work", "work/会議", "日報"];

  test("前方一致で絞る（大文字小文字は区別しない）", () => {
    expect(matchTags("WOR", known)).toEqual(["work", "work/会議"]);
  });

  test("空の打ちかけなら全部", () => {
    expect(matchTags("", known)).toEqual(known);
  });

  test("打ったものと同じだけの候補は出さない", () => {
    // 選ぶものが無いのに一覧が出ていると、Enter が決定か改行か分からない
    expect(matchTags("日報", known)).toEqual([]);
  });

  test("当たらなければ空", () => {
    expect(matchTags("zzz", known)).toEqual([]);
  });
});

function complete(
  doc: string,
  pos: number,
  known: string[],
  composing = false,
) {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
  const source = tagCompletion(() => known);
  // view は変換中かの判定にしか使わないので、それだけの偽物で足りる
  const view = { composing } as unknown as EditorView;
  return source(new CompletionContext(state, pos, false, view));
}

describe("tagCompletion", () => {
  const known = ["work", "work/会議", "日報"];

  test("打ちかけのタグを置き換える範囲と候補を返す", () => {
    const doc = "本文の #wo";
    const result = complete(doc, doc.length, known);
    expect(result?.from).toBe(doc.indexOf("#") + 1); // `#` は残す
    expect(result?.options.map((option) => option.label)).toEqual([
      "work",
      "work/会議",
    ]);
  });

  test("タグの外では出さない", () => {
    expect(complete("ただの本文", 3, known)).toBeNull();
  });

  test("候補が無ければ出さない", () => {
    const doc = "#zzz";
    expect(complete(doc, doc.length, known)).toBeNull();
  });

  test("変換中は出さない（T5。確定前の一覧が変換候補と重なる）", () => {
    const doc = "本文の #wo";
    expect(complete(doc, doc.length, known, true)).toBeNull();
  });

  test("コードの中では出さない（索引もそこはタグと見なさない）", () => {
    const fenced = "```sh\n#wo";
    expect(complete(fenced, fenced.length, known)).toBeNull();
    const inline = "文中の `#wo";
    expect(complete(inline, inline.length, known)).toBeNull();
  });
});
