// フォーカスモード（Cmd+Shift+D、spec §5.4「現在段落以外を減光」）の
// 対象判定と、モードの切り替えの検証。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  focusModeField,
  focusRange,
  setFocusMode,
  setTypewriter,
  typewriterField,
} from "./modes";

function stateOf(doc: string, anchor: number) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
}

describe("focusRange", () => {
  const doc = "# 見出し\n\n一つ目の段落。\n続きの行。\n\n二つ目の段落。\n";

  test("キャレットのある段落の範囲を返す（続きの行も含む）", () => {
    const start = doc.indexOf("一つ目");
    const range = focusRange(stateOf(doc, start + 2));
    expect(range).toEqual({ start, end: doc.indexOf("続きの行。") + 5 });
  });

  test("test_長いノートの終わりでも段落を見つける", () => {
    // **`syntaxTree` は時間で打ち切られる。** 木が未完成のまま返ると
    // 段落が見つからず、減光が丸ごと効かない（2026-09-05 に本番の
    // テストが落ちて発覚。plain-copy・outline と同じ根）
    const filler = Array.from({ length: 3000 }, (_, i) => `行 ${i}`).join("\n");
    const long = `${filler}\n\n最後の段落。\n`;
    const start = long.indexOf("最後の段落。");
    expect(focusRange(stateOf(long, start + 2))).toEqual({
      start,
      end: start + "最後の段落。".length,
    });
  });

  test("見出しの上では見出しだけ", () => {
    const range = focusRange(stateOf(doc, 2));
    expect(range).toEqual({ start: 0, end: "# 見出し".length });
  });

  test("空行の上では減光しない（全体を返す）", () => {
    const blank = doc.indexOf("\n\n二つ目") + 1;
    expect(focusRange(stateOf(doc, blank))).toBeNull();
  });

  test("リストは項目ではなくリスト全体", () => {
    const list = "前\n\n- 一\n- 二\n\n後";
    const range = focusRange(stateOf(list, list.indexOf("一")));
    expect(range).toEqual({
      start: list.indexOf("- 一"),
      end: list.indexOf("- 二") + 3,
    });
  });
});

describe("モードの切り替え", () => {
  test("フォーカスとタイプライタは独立に切り替わる", () => {
    const base = EditorState.create({
      extensions: [focusModeField, typewriterField],
    });
    expect(base.field(focusModeField)).toBe(false);
    expect(base.field(typewriterField)).toBe(false);
    const focused = base.update({ effects: setFocusMode.of(true) }).state;
    expect(focused.field(focusModeField)).toBe(true);
    expect(focused.field(typewriterField)).toBe(false);
    const typed = focused.update({ effects: setTypewriter.of(true) }).state;
    expect(typed.field(focusModeField)).toBe(true);
    expect(typed.field(typewriterField)).toBe(true);
  });
});
