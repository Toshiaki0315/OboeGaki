// ブロック系装飾（§6.4 のリビール表のブロック分）の検証。
// previewDecorations は EditorState だけで動く純関数なので DOM 無しで
// テストできる（widget の描画は除く — それは実機で見る）。

import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState, type Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  bulletGlyph,
  previewDecorations,
  setSourceMode,
  sourceModeField,
} from "./live-preview";

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
    widget?: { glyph?: string; checked?: boolean; url?: string };
  };
  let kind = "hide";
  if (spec.class) kind = `line:${spec.class}`;
  else if (spec.widget?.glyph !== undefined)
    kind = `bullet:${spec.widget.glyph}`;
  else if (spec.widget?.checked !== undefined)
    kind = `checkbox:${spec.widget.checked}`;
  else if (spec.widget?.url !== undefined) kind = `image:${spec.widget.url}`;
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

  test("ソースモード中はすべての装飾を止めて全表示にする", () => {
    const doc = "# 見出し\n\n**強調**と > 引用\n\n- 項目";
    const base = EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [relaxedAsterisk, extendedInline, TaskList] }),
        sourceModeField,
      ],
    });
    expect(previewDecorations(base, 0, doc.length).length).toBeGreaterThan(0);
    const raw = base.update({ effects: setSourceMode.of(true) }).state;
    expect(previewDecorations(raw, 0, doc.length)).toEqual([]);
    const back = raw.update({ effects: setSourceMode.of(false) }).state;
    expect(previewDecorations(back, 0, doc.length).length).toBeGreaterThan(0);
  });

  test("選択範囲が交差する行は、選択の外のマーカーも全表示する", () => {
    const doc = "これは**強調**と*斜体*の行\n\nよそは**太字**のまま";
    const state = EditorState.create({
      doc,
      // 行頭の「これ」だけを選択（強調のマーカーにも端にも触れていない）
      selection: EditorSelection.single(0, 2),
      extensions: [
        markdown({ extensions: [relaxedAsterisk, extendedInline, TaskList] }),
      ],
    });
    const decos = previewDecorations(state, 0, doc.length).map(simplify);
    const strong = doc.indexOf("**強調**");
    const other = doc.indexOf("**太字**");
    // 選択と同じ行のマーカーは隠さない
    expect(has(decos, { from: strong, to: strong + 2, kind: "hide" })).toBe(
      false,
    );
    // 選択の無い行のマーカーは隠したまま
    expect(has(decos, { from: other, to: other + 2, kind: "hide" })).toBe(true);
  });

  test("行まるごと画像の行は絵に置き換え、カーソルが乗るとソースを見せる", () => {
    const doc = "前\n\n![図](attachments/a.png)\n\n後";
    const from = doc.indexOf("![");
    const to = from + "![図](attachments/a.png)".length;
    const away = decorationsOf(doc, 0);
    expect(has(away, { from, to, kind: "image:attachments/a.png" })).toBe(true);
    // 置き換えた行では、内側のマーカー隠しを重ねない
    expect(
      away.some((d) => d.kind === "hide" && d.from >= from && d.to <= to),
    ).toBe(false);
    const onLine = decorationsOf(doc, from + 2);
    expect(onLine.some((d) => d.kind.startsWith("image:"))).toBe(false);
  });

  test("文中の画像とリモート画像は絵にしない（参照実装 ADR-0004 と同じ）", () => {
    const mid = "文中の ![図](attachments/a.png) は絵にしない\n\n他";
    expect(
      decorationsOf(mid, mid.length).some((d) => d.kind.startsWith("image:")),
    ).toBe(false);
    const remote = "![外](https://example.com/a.png)\n\n他";
    expect(
      decorationsOf(remote, remote.length).some((d) =>
        d.kind.startsWith("image:"),
      ),
    ).toBe(false);
  });

  test("チェックボックスへのイベントは CM6 に渡さない（実機の回帰）", () => {
    // ignoreEvent が false だと、mousedown で CM6 がカーソルをその行に置き、
    // リビールで widget が消えて click が成立しない（2026-09-03 実機で発覚）
    const doc = "- [ ] やる\n\n他";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown({ extensions: [relaxedAsterisk, extendedInline, TaskList] }),
      ],
    });
    const checkbox = previewDecorations(state, 0, doc.length)
      .map(
        (r) =>
          r.value.spec as {
            widget?: { checked?: boolean; ignoreEvent?: (e: Event) => boolean };
          },
      )
      .find((spec) => spec.widget?.checked !== undefined)?.widget;
    expect(checkbox).toBeDefined();
    expect(checkbox!.ignoreEvent!(new Event("mousedown"))).toBe(true);
  });
});
