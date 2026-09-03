// ブロック系装飾（§6.4 のリビール表のブロック分）の検証。
// previewDecorations は EditorState だけで動く純関数なので DOM 無しで
// テストできる（widget の描画は除く — それは実機で見る）。

import { describe, expect, test } from "vitest";
import { EditorState, type Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { bulletGlyph, previewDecorations } from "./live-preview";

type Deco = {
  from: number;
  to: number;
  kind: string; // "hide" | "line:<class>" | "bullet:<glyph>" | "checkbox:<checked>" | "hr"
};

function decorationsOf(doc: string, anchor: number): Deco[] {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ extensions: [relaxedAsterisk, extendedInline, TaskList] }),
    ],
  });
  return previewDecorations(state, 0, doc.length).map(simplify);
}

function simplify(range: Range<Decoration>): Deco {
  const spec = range.value.spec as {
    class?: string;
    widget?: { glyph?: string; checked?: boolean };
  };
  let kind = "hide";
  if (spec.class) kind = `line:${spec.class}`;
  else if (spec.widget?.glyph !== undefined)
    kind = `bullet:${spec.widget.glyph}`;
  else if (spec.widget?.checked !== undefined)
    kind = `checkbox:${spec.widget.checked}`;
  else if (spec.widget) kind = "hr";
  return { from: range.from, to: range.to, kind };
}

const has = (decos: Deco[], expected: Deco) =>
  decos.some(
    (d) =>
      d.from === expected.from &&
      d.to === expected.to &&
      d.kind === expected.kind,
  );

describe("bulletGlyph", () => {
  test("深さで ● ○ ■ を巡回する（ADR-0026）", () => {
    expect([0, 1, 2, 3].map(bulletGlyph)).toEqual(["●", "○", "■", "●"]);
  });
});

describe("previewDecorations（ブロック系）", () => {
  test("引用は > を隠して行に縦バーのクラスを付ける", () => {
    const doc = "> 引用です\n\n本文";
    const decos = decorationsOf(doc, doc.length); // カーソルは引用の外
    expect(has(decos, { from: 0, to: 2, kind: "hide" })).toBe(true);
    expect(
      has(decos, { from: 0, to: 0, kind: "line:cm-blockquote-line" }),
    ).toBe(true);
  });

  test("引用の行にカーソルがあると > を見せる（縦バーは維持）", () => {
    const doc = "> 引用です\n\n本文";
    const decos = decorationsOf(doc, 3); // 引用行の中
    expect(has(decos, { from: 0, to: 2, kind: "hide" })).toBe(false);
    expect(
      has(decos, { from: 0, to: 0, kind: "line:cm-blockquote-line" }),
    ).toBe(true);
  });

  test("コードブロックは全行に背景を付けフェンス行を隠す", () => {
    const doc = "本文\n\n```js\nconst a = 1;\n```\n\nあと";
    const decos = decorationsOf(doc, 0); // ブロックの外
    const fenceOpen = doc.indexOf("```js");
    const codeLine = doc.indexOf("const");
    const fenceClose = doc.lastIndexOf("```");
    for (const lineFrom of [fenceOpen, codeLine, fenceClose]) {
      expect(
        has(decos, {
          from: lineFrom,
          to: lineFrom,
          kind: "line:cm-codeblock-line",
        }),
        `line ${lineFrom}`,
      ).toBe(true);
    }
    expect(
      has(decos, { from: fenceOpen, to: fenceOpen + 5, kind: "hide" }),
    ).toBe(true);
    expect(
      has(decos, { from: fenceClose, to: fenceClose + 3, kind: "hide" }),
    ).toBe(true);
  });

  test("コードブロックの中にカーソルがあるとフェンスを見せる（背景は維持）", () => {
    const doc = "本文\n\n```js\nconst a = 1;\n```\n\nあと";
    const decos = decorationsOf(doc, doc.indexOf("const") + 2);
    const fenceOpen = doc.indexOf("```js");
    expect(
      has(decos, { from: fenceOpen, to: fenceOpen + 5, kind: "hide" }),
    ).toBe(false);
    expect(
      has(decos, {
        from: fenceOpen,
        to: fenceOpen,
        kind: "line:cm-codeblock-line",
      }),
    ).toBe(true);
  });

  test("水平線は線の描画に置き換え、カーソルが乗ると原文を見せる", () => {
    const doc = "a\n\n---\n\nb";
    const hrFrom = doc.indexOf("---");
    const away = decorationsOf(doc, 0);
    expect(has(away, { from: hrFrom, to: hrFrom + 3, kind: "hr" })).toBe(true);
    const onLine = decorationsOf(doc, hrFrom + 1);
    expect(has(onLine, { from: hrFrom, to: hrFrom + 3, kind: "hr" })).toBe(
      false,
    );
  });

  test("箇条書きの点は深さで描き分け、番号付きは残す", () => {
    const doc = "- 親\n  - 子\n\n1. 番号\n\n他";
    const decos = decorationsOf(doc, doc.length);
    expect(has(decos, { from: 0, to: 2, kind: "bullet:●" })).toBe(true);
    const child = doc.indexOf("- 子");
    expect(has(decos, { from: child, to: child + 2, kind: "bullet:○" })).toBe(
      true,
    );
    const ordered = doc.indexOf("1.");
    expect(decos.some((d) => d.from === ordered && d.kind !== "hide")).toBe(
      false,
    );
  });

  test("箇条書きの行にカーソルがあると原文を見せる", () => {
    const doc = "- 項目\n\n他";
    const decos = decorationsOf(doc, 3);
    expect(decos.some((d) => d.kind.startsWith("bullet:"))).toBe(false);
  });

  test("タスクはチェックボックスに置き換え、完了状態を反映する", () => {
    const doc = "- [ ] やる\n- [x] 済み\n\n他";
    const decos = decorationsOf(doc, doc.length);
    expect(has(decos, { from: 0, to: 6, kind: "checkbox:false" })).toBe(true);
    const done = doc.indexOf("- [x]");
    expect(
      has(decos, { from: done, to: done + 6, kind: "checkbox:true" }),
    ).toBe(true);
  });
});
