// @vitest-environment jsdom
// 改行をまたぐ置き換えでノートが開けなくならない（24-3）。CM6 は plugin から出す
// 装飾が改行を置き換えると投げる（画面が作れず、ノートが開けない）

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { livePreview, previewDecorations } from "./live-preview";
import { LANG } from "./test-utils";

const docs = [
  // wiki リンクの別名の中に改行（以前は名前と縦棒を隠す範囲が改行をまたいだ）
  "前\n\n[[名前\n続き|表示]]\n\n後ろ",
  // 埋め込みの名前の中に改行
  "前\n\n![[名前\n続き]]\n\n後ろ",
  // 色の span の開きタグの中に改行（タグを隠す範囲が改行をまたいだ）
  '<span\nstyle="color: red">赤</span>\n\n後',
];

describe("改行をまたぐ置き換え（24-3）", () => {
  test.each(docs)("test_開いても投げない %j", (doc) => {
    expect(() => {
      const view = new EditorView({
        state: EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: [LANG, livePreview],
        }),
        parent: document.body,
      });
      view.destroy();
    }).not.toThrow();
  });

  test.each(docs)("test_置き換えは改行を含まない %j", (doc) => {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [LANG],
    });
    for (const range of previewDecorations(state, 0, doc.length)) {
      if (
        !(range.value.spec as { widget?: unknown }).widget &&
        range.from < range.to
      ) {
        const text = doc.slice(range.from, range.to);
        if ((range.value as { point?: boolean }).point)
          expect(text, JSON.stringify(range)).not.toContain("\n");
      }
    }
  });

  test("test_行をまたぐ_[[…]]_はリンクにしない", () => {
    const doc = "[[名前\n続き]]";
    const state = EditorState.create({ doc, extensions: [LANG] });
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: (node) => void names.push(node.name) });
    expect(names).not.toContain("WikiLink");
  });
});
