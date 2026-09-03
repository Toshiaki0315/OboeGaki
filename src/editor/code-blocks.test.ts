// コードブロックの言語解決とファイル名ラベル（TASKS 2-1、ADR-0008）。

import { describe, expect, it, test } from "vitest";
import { EditorState, type Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { previewDecorations } from "./live-preview";
import { resolveCodeLanguage, splitFenceInfo } from "./code-blocks";

describe("splitFenceInfo", () => {
  it.each([
    ["言語だけ", "python", "python", null],
    ["言語とファイル名", "python:aaa.py", "python", "aaa.py"],
    ["ファイル名にコロン", "ts:src:main.ts", "ts", "src:main.ts"],
    ["空", "", "", null],
    ["前後の空白は落とす", " rust ", "rust", null],
  ])("test_%s", (_label, info, lang, fileName) => {
    expect(splitFenceInfo(info)).toEqual({ lang, fileName });
  });
});

describe("resolveCodeLanguage", () => {
  it("test_言語名で見つかる", () => {
    expect(resolveCodeLanguage("python")).not.toBeNull();
    expect(resolveCodeLanguage("rust")).not.toBeNull();
  });

  it("test_別名でも見つかる", () => {
    expect(resolveCodeLanguage("py")).not.toBeNull();
    expect(resolveCodeLanguage("js")).not.toBeNull();
  });

  it("test_ファイル名付きでも言語が見つかる", () => {
    // `python:aaa.py` を丸ごと言語名にすると色分けが効かない（ADR-0008）
    const found = resolveCodeLanguage("python:aaa.py");
    expect(found?.name).toBe(resolveCodeLanguage("python")?.name);
  });

  it("test_知らない言語はnull", () => {
    expect(resolveCodeLanguage("なにか")).toBeNull();
    expect(resolveCodeLanguage("")).toBeNull();
  });
});

// --- フェンス行のファイル名ラベル（previewDecorations 経由） ---

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function decorationsOf(doc: string, anchor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [LANG],
  });
  return previewDecorations(state, 0, doc.length);
}

function fileNamesOf(ranges: readonly Range<Decoration>[]): string[] {
  return ranges
    .map((r) => (r.value.spec as { widget?: { fileName?: string } }).widget)
    .filter((w): w is { fileName: string } => typeof w?.fileName === "string")
    .map((w) => w.fileName);
}

const FENCE_WITH_NAME = "```python:aaa.py\nprint(1)\n```\n";
const FENCE_PLAIN = "```python\nprint(1)\n```\n";

test("test_ファイル名付きフェンスは行を潰さずラベルを出す", () => {
  const caretOutside = FENCE_WITH_NAME.length;
  const found = fileNamesOf(decorationsOf(FENCE_WITH_NAME, caretOutside));
  expect(found).toEqual(["aaa.py"]);
});

test("test_ファイル名の無いフェンスは今まで通り行ごと隠す", () => {
  const caretOutside = FENCE_PLAIN.length;
  expect(fileNamesOf(decorationsOf(FENCE_PLAIN, caretOutside))).toEqual([]);
});

test("test_ブロックに触れている間はラベルではなくソースを見せる", () => {
  expect(fileNamesOf(decorationsOf(FENCE_WITH_NAME, 5))).toEqual([]);
});
