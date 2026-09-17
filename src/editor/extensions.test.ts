// エディタの拡張一式（extensions.ts）。本番とベンチが同じものを組むことと、
// 解析の設定・見た目の切り替えを見る（棚卸し 2026-09-17）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  coreExtensions,
  highlightsFor,
  markdownConfig,
  NOOP_CORE,
} from "./extensions";
import { tableField, wysiwygField } from "./live-preview";
import { focusModeField, typewriterField } from "./modes";

function stateWith(doc: string, indentedCode?: boolean) {
  return EditorState.create({
    doc,
    extensions: coreExtensions({
      ...NOOP_CORE,
      indentedCode,
      highlights: highlightsFor(false),
      focus: true,
      typewriter: false,
    }),
  });
}

describe("coreExtensions", () => {
  test("test_一式で_state_が組め_見え方の初期値が入る", () => {
    const state = stateWith("# 題\n\n| a |\n| - |\n| 1 |\n");
    expect(state.field(focusModeField)).toBe(true);
    expect(state.field(typewriterField)).toBe(false);
    expect(state.field(wysiwygField)).toBe(false); // 初期値は Editor 側が init で上書きする
    expect(state.field(tableField, false)).toBeDefined();
  });

  test("test_字下げのコードは切れる（ADR-0033）", () => {
    const doc = "本文\n\n    code\n";
    const names = (state: EditorState) => {
      const found: string[] = [];
      syntaxTree(state).iterate({ enter: (n) => void found.push(n.name) });
      return found;
    };
    expect(names(stateWith(doc, true))).toContain("CodeBlock");
    expect(names(stateWith(doc, false))).not.toContain("CodeBlock");
  });

  test("test_markdownConfig_は本文と埋め込みで同じものを返す（複写しない）", () => {
    const a = EditorState.create({
      doc: "**a**",
      extensions: [markdownConfig()],
    });
    expect(syntaxTree(a).topNode.firstChild?.name).toBe("Paragraph");
  });

  test("test_ソースモードでは見た目を外す", () => {
    expect(highlightsFor(true)).toEqual([]);
    expect(Array.isArray(highlightsFor(false))).toBe(true);
  });
});
