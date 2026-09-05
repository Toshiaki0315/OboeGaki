// コードの言語の補完（TASKS 6-3、要望 2026-09-05）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { resolveCodeLanguage } from "./code-blocks";
import {
  fenceLanguageCompletion,
  fencePrefixAt,
  LANGUAGE_OPTIONS,
} from "./fence-language";

describe("fencePrefixAt", () => {
  test("test_フェンスの直後に打っている言葉を返す", () => {
    expect(fencePrefixAt("```c", 4)).toBe("c");
    expect(fencePrefixAt("~~~py", 5)).toBe("py");
  });

  test("test_1 文字も打っていなければ出さない", () => {
    // ` ``` ` だけで一覧が出ると、Enter が候補の決定に化ける
    expect(fencePrefixAt("```", 3)).toBeNull();
  });

  test("test_ファイル名のところでは出さない（ADR-0008）", () => {
    expect(fencePrefixAt("```python:aaa.py", 16)).toBeNull();
  });

  test("test_フェンスの行でなければ出さない", () => {
    expect(fencePrefixAt("本文の c", 5)).toBeNull();
    expect(fencePrefixAt("  ```c", 6)).toBeNull(); // 字下げはコード例
  });

  test("test_カーソルより後ろがあるときは出さない", () => {
    expect(fencePrefixAt("```cpp", 4)).toBeNull();
  });
});

describe("LANGUAGE_OPTIONS", () => {
  test("test_打つ綴りと読める名前の両方を持つ", () => {
    const cpp = LANGUAGE_OPTIONS.find((option) => option.token === "cpp");
    expect(cpp?.name).toBe("C++");
  });

  test("test_名前も別名も出す（どちらで打っても辿り着ける）", () => {
    const tokens = LANGUAGE_OPTIONS.map((option) => option.token);
    expect(tokens).toContain("c++"); // 名前そのもの
    expect(tokens).toContain("cpp"); // 別名
    expect(tokens).toContain("javascript");
    expect(tokens).toContain("js");
  });

  test("test_同じ綴りを 2 つ置かない", () => {
    const tokens = LANGUAGE_OPTIONS.map((option) => option.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test("test_出すのは**実際に色が付く言語**だけ", () => {
    // 選んだのに色が付かない、が起きないよう、色付けと同じ表から引く
    for (const option of LANGUAGE_OPTIONS) {
      expect(resolveCodeLanguage(option.token), option.token).not.toBeNull();
    }
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
  return fenceLanguageCompletion()(
    new CompletionContext(state, pos, false, view),
  );
}

describe("fenceLanguageCompletion", () => {
  test("test_打った言葉だけを置き換える", () => {
    const doc = "本文\n\n```c";
    const result = complete(doc, doc.length);
    expect(result?.from).toBe(doc.length - 1); // ``` は残す
    expect(result?.options.map((option) => option.label)).toContain("cpp");
  });

  test("test_読める名前も添える", () => {
    const doc = "```cp";
    const found = complete(doc, doc.length)?.options.find(
      (option) => option.label === "cpp",
    );
    expect(found?.detail).toBe("C++");
  });

  test("test_フェンスの行でなければ出さない", () => {
    expect(complete("ただの本文", 3)).toBeNull();
  });

  test("test_変換中は出さない（T5）", () => {
    expect(complete("```c", 4, true)).toBeNull();
  });

  test("test_知らない綴りなら出さない", () => {
    expect(complete("```zzzz", 7)).toBeNull();
  });
});
