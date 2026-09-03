// ブロック系装飾（§6.4 のリビール表のブロック分）の検証。
// previewDecorations は EditorState だけで動く純関数なので DOM 無しで
// テストできる（widget の描画は除く — それは実機で見る）。

import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState, type Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import {
  bulletGlyph,
  blockWidgetDecorations,
  blockWidgetField,
  previewDecorations,
  setSourceMode,
  sourceModeField,
  tableDecorations,
  tableField,
  type TableData,
} from "./live-preview";

type Deco = {
  from: number;
  to: number;
  kind: string; // "hide" | "line:<class>" | "bullet:<glyph>" | "checkbox:<checked>" | "hr"
};

const LANG = markdown({
  extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
});

function stateOf(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions: [LANG] });
}

function decorationsOf(doc: string, anchor: number): Deco[] {
  return previewDecorations(stateOf(doc, anchor), 0, doc.length).map(simplify);
}

function blocksOf(doc: string, anchor: number): Deco[] {
  return blockWidgetDecorations(stateOf(doc, anchor)).map(simplify);
}

function tableWidgetOf(doc: string, anchor: number): TableData | null {
  const found = tableDecorations(stateOf(doc, anchor))
    .map((r) => r.value.spec as { widget?: { data?: TableData } })
    .find((spec) => spec.widget?.data !== undefined);
  return found?.widget?.data ?? null;
}

function simplify(range: Range<Decoration>): Deco {
  const spec = range.value.spec as {
    class?: string;
    widget?: {
      glyph?: string;
      checked?: boolean;
      url?: string;
      mathml?: string;
      code?: string;
    };
  };
  let kind = "hide";
  if (spec.class) kind = `line:${spec.class}`;
  else if (spec.widget?.glyph !== undefined)
    kind = `bullet:${spec.widget.glyph}`;
  else if (spec.widget?.checked !== undefined)
    kind = `checkbox:${spec.widget.checked}`;
  else if (spec.widget?.url !== undefined) kind = `image:${spec.widget.url}`;
  else if (spec.widget?.mathml !== undefined) kind = "math";
  else if (spec.widget?.code !== undefined) kind = "mermaid";
  else if (spec.widget) kind = "hr";
  return { from: range.from, to: range.to, kind };
}

/// 行クラスは複数付く（帯 + 上下の端）ので、**含むか**で見る。
const hasLineClass = (decos: Deco[], from: number, className: string) =>
  decos.some(
    (deco) =>
      deco.from === from &&
      deco.kind.startsWith("line:") &&
      deco.kind.slice("line:".length).split(" ").includes(className),
  );

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
    expect(hasLineClass(decos, 0, "cm-blockquote-line")).toBe(true);
  });

  test("引用の行にカーソルがあると > を見せる（縦バーは維持）", () => {
    const doc = "> 引用です\n\n本文";
    const decos = decorationsOf(doc, 3); // 引用行の中
    expect(has(decos, { from: 0, to: 2, kind: "hide" })).toBe(false);
    expect(hasLineClass(decos, 0, "cm-blockquote-line")).toBe(true);
  });

  test("**中身の行にだけ**背景を付け、フェンス行を隠す", () => {
    // フェンス（```）は書き方であって中身ではない（`:::note` と同じ扱い）
    const doc = "本文\n\n```js\nconst a = 1;\n```\n\nあと";
    const decos = decorationsOf(doc, 0); // ブロックの外
    const fenceOpen = doc.indexOf("```js");
    const codeLine = doc.indexOf("const");
    const fenceClose = doc.lastIndexOf("```");
    expect(hasLineClass(decos, codeLine, "cm-codeblock-line")).toBe(true);
    expect(hasLineClass(decos, fenceOpen, "cm-codeblock-line")).toBe(false);
    expect(hasLineClass(decos, fenceClose, "cm-codeblock-line")).toBe(false);
    // 帯の上下の端には印が付く（内側に余白を作るため）
    expect(hasLineClass(decos, codeLine, "cm-codeblock-line-first")).toBe(true);
    expect(hasLineClass(decos, codeLine, "cm-codeblock-line-last")).toBe(true);
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
    // 背景は中身の行に残る（フェンス行には元から付けない）
    expect(hasLineClass(decos, doc.indexOf("const"), "cm-codeblock-line")).toBe(
      true,
    );
    expect(hasLineClass(decos, fenceOpen, "cm-codeblock-line")).toBe(false);
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

  test("previewDecorations はブロック構造に触れない（ViewPlugin の制約）", () => {
    // 実機で発覚: block widget や改行をまたぐ replace を ViewPlugin から
    // 出すと CM6 が拒否し、表が描かれなかった（2026-09-04）。
    // ブロック構造を変える装飾は StateField（tableDecorations）に置く
    const doc =
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![図](attachments/a.png)\n\n---\n\n文";
    const state = stateOf(doc, doc.length - 1);
    for (const range of previewDecorations(state, 0, doc.length)) {
      const spec = range.value.spec as { block?: boolean };
      expect(spec.block ?? false, `block at ${range.from}`).toBe(false);
      if (range.from !== range.to) {
        expect(
          state.sliceDoc(range.from, range.to).includes("\n"),
          `改行またぎ at ${range.from}..${range.to}`,
        ).toBe(false);
      }
    }
  });

  test("表は範囲外にカーソルがあるとき table widget に置き換える", () => {
    const doc =
      "前\n\n| 名前 | 数 |\n| :--- | ---: |\n| りんご | 3 |\n| **太字** | 1 |\n\n後";
    const data = tableWidgetOf(doc, 0);
    expect(data).toEqual({
      header: [[{ text: "名前", kinds: [] }], [{ text: "数", kinds: [] }]],
      aligns: ["left", "right"],
      rows: [
        [[{ text: "りんご", kinds: [] }], [{ text: "3", kinds: [] }]],
        [[{ text: "太字", kinds: ["strong"] }], [{ text: "1", kinds: [] }]],
      ],
    });
    // 置き換えた範囲では内側のマーカー隠しを重ねない
    const from = doc.indexOf("|");
    const decos = decorationsOf(doc, 0);
    expect(decos.some((d) => d.kind === "hide" && d.from >= from)).toBe(false);
  });

  test("セル内のインライン記法を描き分ける（ADR-0031）", () => {
    const doc =
      "| A | B |\n| --- | --- |\n| `Cmd+N` を押す | a~~打ち消し~~と::目立つ:: |\n| [説明](https://x.com) | #タグ です |\n\n他";
    const data = tableWidgetOf(doc, doc.length)!;
    expect(data.rows[0][0]).toEqual([
      { text: "Cmd+N", kinds: ["code"] },
      { text: " を押す", kinds: [] },
    ]);
    expect(data.rows[0][1]).toEqual([
      { text: "a", kinds: [] },
      { text: "打ち消し", kinds: ["strike"] },
      { text: "と", kinds: [] },
      { text: "目立つ", kinds: ["highlight"] },
    ]);
    // リンクは対象外: 記号だけ消すと URL が見えなくなるので生のまま
    expect(data.rows[1][0]).toEqual([
      { text: "[説明](https://x.com)", kinds: [] },
    ]);
    // タグは # ごと描く
    expect(data.rows[1][1]).toEqual([
      { text: "#タグ", kinds: ["tag"] },
      { text: " です", kinds: [] },
    ]);
  });

  test("セル内の入れ子は種類の集合で持つ", () => {
    // 入れ子の形はオラクル済みの「**bold *em* here**」型を使う
    // （`**…*…***` のように閉じを繋げた形は参照実装でも対にならない）
    const doc = "| A |\n| --- |\n| **太字の*斜体*も** |\n\n他";
    const data = tableWidgetOf(doc, doc.length)!;
    expect(data.rows[0][0]).toEqual([
      { text: "太字の", kinds: ["strong"] },
      { text: "斜体", kinds: ["strong", "em"] },
      { text: "も", kinds: ["strong"] },
    ]);
  });

  test("表の中にカーソルがあるときは生のソースを見せる（表単位リビール）", () => {
    const doc = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n他";
    expect(tableWidgetOf(doc, doc.indexOf("1"))).toBeNull();
    expect(tableWidgetOf(doc, doc.length)).not.toBeNull();
  });

  test("表に関わらない編集では表の装飾セットを使い回す（性能）", () => {
    // ベンチで発覚: 打鍵・カーソル移動のたびに全表を再抽出すると
    // 10,000 語 + 多数の表で p95 が 16ms を割る
    const doc =
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n本文の段落。\n\nもう一つの段落。";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [LANG, sourceModeField, tableField],
    });
    const before = state.field(tableField);
    expect(before.size).toBe(1);

    // 表から離れた場所での挿入 → 同じ装飾セットのまま（位置写像のみ）
    const typed = state.update({
      changes: { from: doc.length, insert: "あ" },
      selection: { anchor: doc.length + 1 },
    }).state;
    expect(typed.field(tableField).size).toBe(1);
    expect((typed.field(tableField) as unknown) === (before as unknown)).toBe(
      false,
    ); // 写像で新しいインスタンスにはなる
    // 表の外どうしのカーソル移動 → 再計算しない（同一インスタンス）
    const moved = typed.update({
      selection: { anchor: doc.indexOf("段落") },
    }).state;
    expect(moved.field(tableField)).toBe(typed.field(tableField));

    // 表へカーソルが入る → リビール（装飾が消える）
    const inTable = moved.update({ selection: { anchor: 2 } }).state;
    expect(inTable.field(tableField).size).toBe(0);
    // 表から出る → 表が戻る
    const outAgain = inTable.update({
      selection: { anchor: doc.indexOf("本文") },
    }).state;
    expect(outAgain.field(tableField).size).toBe(1);

    // 表の中身を編集 → 再抽出される（古いセルのまま残らない）
    const edited = outAgain.update({
      changes: {
        from: doc.indexOf("1"),
        to: doc.indexOf("1") + 1,
        insert: "9",
      },
    }).state;
    const data = (
      edited.field(tableField).iter().value?.spec as {
        widget?: { data?: TableData };
      }
    ).widget?.data;
    expect(data?.rows).toEqual([
      [[{ text: "9", kinds: [] }], [{ text: "2", kinds: [] }]],
    ]);
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

describe("セル内の <br>（ADR-0028）", () => {
  test("test_brで断片が分かれ改行として描かれる", () => {
    const doc = "| 列A |\n| --- |\n| 一行目<br>二行目 |\n";
    const data = tableWidgetOf(doc, doc.length);
    expect(data).not.toBeNull();
    expect(data!.rows[0][0]).toEqual([
      { text: "一行目", kinds: [] },
      { text: "\n", kinds: ["br"] },
      { text: "二行目", kinds: [] },
    ]);
  });

  test("test_変種のbrも同義", () => {
    const doc = "| 列A |\n| --- |\n| a<br/>b<BR />c |\n";
    const data = tableWidgetOf(doc, doc.length);
    const kinds = data!.rows[0][0].map((s) => s.kinds.join(","));
    expect(kinds).toEqual(["", "br", "", "br", ""]);
  });

  test("test_本文のbrは文字のまま", () => {
    // <br> が意味を持つのは表のセルの中だけ（ADR-0028）
    const doc = "本文の<br>はそのまま\n";
    const decos = decorationsOf(doc, doc.length);
    expect(decos.every((d) => d.kind !== "hide")).toBe(true);
  });
});

describe("数式（ADR-0036）", () => {
  test("インライン数式を組んで置き換える", () => {
    const doc = "式は $E = mc^2$ です";
    const from = doc.indexOf("$");
    const to = doc.lastIndexOf("$") + 1;
    expect(has(decorationsOf(doc, 0), { from, to, kind: "math" })).toBe(true);
  });

  test("キャレットが触れている間は生の LaTeX に戻す", () => {
    const doc = "式は $E = mc^2$ です";
    const inside = doc.indexOf("mc");
    expect(decorationsOf(doc, inside).some((d) => d.kind === "math")).toBe(
      false,
    );
  });

  test("組めない式は置き換えない（直せる状態を保つ）", () => {
    const doc = "壊れた $\\frac{a$ です";
    expect(decorationsOf(doc, 0).some((d) => d.kind === "math")).toBe(false);
  });

  test("値段は数式にしない", () => {
    const doc = "価格は $100 と $200 です";
    expect(decorationsOf(doc, 0).some((d) => d.kind === "math")).toBe(false);
  });

  test("行をまたぐ `$$` ブロックを組む", () => {
    const doc = "本文\n\n$$\n\\frac{a}{b}\n$$\n\n続き";
    const from = doc.indexOf("$$");
    const to = doc.lastIndexOf("$$") + 2;
    expect(has(blocksOf(doc, 0), { from, to, kind: "math" })).toBe(true);
  });

  test("ブロックはどの行に触れても式全体が生に戻る", () => {
    const doc = "$$\n\\frac{a}{b}\n$$\n";
    const middle = doc.indexOf("frac");
    expect(blocksOf(doc, middle).some((d) => d.kind === "math")).toBe(false);
  });

  test("閉じの無い `$$` はブロックにしない（以降が全部数式にならない）", () => {
    const doc = "$$\n\\frac{a}{b}\n\nふつうの本文";
    expect(blocksOf(doc, 0).some((d) => d.kind === "math")).toBe(false);
  });

  test("コードの中は数式にしない", () => {
    const doc = "`$x$` と書く";
    expect(decorationsOf(doc, 0).some((d) => d.kind === "math")).toBe(false);
  });
});

describe("Mermaid 図（ADR-0021）", () => {
  const doc = "本文\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\n続き";

  test("ブロックまるごと図に置き換える", () => {
    const from = doc.indexOf("```");
    const to = doc.lastIndexOf("```") + 3;
    expect(has(blocksOf(doc, 0), { from, to, kind: "mermaid" })).toBe(true);
  });

  test("キャレットが触れている間はコードのまま（式と同じ判断）", () => {
    const inside = doc.indexOf("graph");
    expect(blocksOf(doc, inside).some((d) => d.kind === "mermaid")).toBe(false);
  });

  test("他の言語のフェンスは図にしない", () => {
    const code = "```js\nlet a = 1;\n```\n";
    expect(blocksOf(code, 0).some((d) => d.kind === "mermaid")).toBe(false);
  });
});

describe("長いノートの下のほうにある表（実機で発覚 2026-09-04）", () => {
  // 開いた時点では文書の途中までしか解析されていない。スクロールで解析が
  // 進んだことは docChanged にも selection にも出ないので、それを見ないと
  // **表が生のまま残る**
  const doc =
    "本文の行です。\n".repeat(4000) + "\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";

  test("解析が届いていない間は表が見つからない（前提の確認）", () => {
    const state = EditorState.create({ doc, extensions: [LANG, tableField] });
    expect(state.field(tableField).size).toBe(0);
  });

  test("解析が進んだら数え直して表になる", () => {
    const state = EditorState.create({ doc, extensions: [LANG, tableField] });
    ensureSyntaxTree(state, doc.length, 5000);
    // 解析が進んだあとに来るトランザクション（中身は空でもよい）
    const next = state.update({}).state;
    expect(next.field(tableField).size).toBe(1);
  });
});

describe("plugin 由来の装飾は行をまたがない（実機で発覚 2026-09-04）", () => {
  // CM6 はブロック構造を変える装飾を plugin 由来の装飾に許さず、**投げる**
  // （画面が真っ白になる）。ADR-0035 が表で踏んだ罠を、数式と図でもう一度
  // 踏んだ。**この不変条件を試験で固定する**
  const docs = [
    "本文\n\n$$\n\\frac{a}{b}\n$$\n\n続き",
    "本文\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\n続き",
    "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
    "# 見出し\n\n- 箇条書き\n\n> 引用\n\n```js\nlet a = 1;\n```\n",
  ];

  test("previewDecorations が返す範囲に改行が入らない", () => {
    for (const doc of docs) {
      for (const range of previewDecorations(stateOf(doc, 0), 0, doc.length)) {
        const spec = range.value.spec as { class?: string };
        if (spec.class) continue; // 行クラスは範囲を置き換えない
        expect(doc.slice(range.from, range.to)).not.toContain("\n");
      }
    }
  });
});

describe("`:::note` の囲み（B-3）", () => {
  const doc = "前\n\n:::note warn\n注意です。\n:::\n\n後";

  test("**中身の行にだけ**色を付け、区切り行を隠す", () => {
    // 区切り（`:::note …` と `:::`）は書き方であって中身ではない
    const found = blocksOf(doc, 0);
    const lines = found.filter((deco) => deco.kind.startsWith("line:"));
    expect(lines).toHaveLength(1); // 本文の 1 行だけ
    expect(lines[0].kind).toContain("cm-note-warn");
    expect(lines[0].from).toBe(doc.indexOf("注意です。"));
    const hidden = found.filter((deco) => deco.kind === "hide");
    expect(hidden).toHaveLength(2); // 開きと閉じの行
  });

  test("区切り行が見えているときも、その行には色を付けない", () => {
    // 綴り違いは区切り行を隠さないが、帯は中身だけに掛かる
    const warm = ":::note warm\n本文\nもう 1 行\n:::\n";
    const lines = blocksOf(warm, 0).filter((deco) =>
      deco.kind.startsWith("line:"),
    );
    expect(lines).toHaveLength(2); // 本文の 2 行だけ
    expect(lines[0].from).toBe(warm.indexOf("本文"));
  });

  test("中身の無い囲みでも壊れない", () => {
    const empty = ":::note info\n:::\n";
    expect(() => blocksOf(empty, 0)).not.toThrow();
    expect(
      blocksOf(empty, 0).filter((deco) => deco.kind.startsWith("line:")),
    ).toHaveLength(0);
  });

  test("キャレットが触れている間は区切り行を見せる", () => {
    const inside = doc.indexOf("注意");
    const hidden = blocksOf(doc, inside).filter((d) => d.kind === "hide");
    expect(hidden).toHaveLength(0);
  });

  test("**知らない綴りは区切り行も隠さない**（間違いに気づける）", () => {
    const warm = "​:::note warm\n本文\n:::\n".replace("​", "");
    const found = blocksOf(warm, 0);
    expect(found.some((deco) => deco.kind.includes("cm-note-unknown"))).toBe(
      true,
    );
    expect(found.filter((deco) => deco.kind === "hide")).toHaveLength(0);
  });

  test("囲みの中の強調はふつうに効く（木を触っていない）", () => {
    const bold = ":::note info\n**強調**です\n:::\n";
    const marks = decorationsOf(bold, 0).filter((deco) => deco.kind === "hide");
    // `**` の開きと閉じが隠れている
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("blockWidgetField の再計算の間引き（性能）", () => {
  // レビューで発覚: 毎打鍵・毎カーソル移動で全行走査 + 全数式の組み直しが
  // 走り、打鍵 p95 が 16ms を割った（実測 17〜25ms）。表と同じ
  // 「ゾーン + 位置写像 + リビール鍵」で間引く
  const doc = "$$\nx = 1\n$$\n\n:::note\n中身\n:::\n\n本文の段落。\nもう一つ。";

  function fieldStates() {
    return EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [LANG, sourceModeField, blockWidgetField],
    });
  }

  test("test_数式にも囲みにも関わらない編集では装飾セットを写像で使い回す", () => {
    const state = fieldStates();
    const before = state.field(blockWidgetField);
    expect(before.size).toBeGreaterThan(0);
    const typed = state.update({
      changes: { from: doc.length, insert: "あ" },
      selection: { anchor: doc.length + 1 },
    }).state;
    // 写像はするが再抽出はしない（中身のインスタンスが保たれる）
    const widgetsBefore = [...iterWidgets(before)];
    const widgetsAfter = [...iterWidgets(typed.field(blockWidgetField))];
    expect(widgetsAfter.length).toBe(widgetsBefore.length);
    expect(widgetsAfter[0]).toBe(widgetsBefore[0]);
  });

  test("test_ゾーンの外どうしのカーソル移動では再計算しない", () => {
    const state = fieldStates();
    const moved = state.update({
      selection: { anchor: doc.indexOf("本文") },
    }).state;
    expect(moved.field(blockWidgetField)).toBe(state.field(blockWidgetField));
  });

  test("test_数式へ入るとリビールし出ると戻る", () => {
    const state = fieldStates();
    const before = state.field(blockWidgetField).size;
    const inside = state.update({ selection: { anchor: 1 } }).state;
    expect(inside.field(blockWidgetField).size).toBeLessThan(before);
    const outside = inside.update({
      selection: { anchor: doc.indexOf("本文") },
    }).state;
    expect(outside.field(blockWidgetField).size).toBe(before);
  });

  test("test_数式の中身の編集では再抽出される", () => {
    const state = fieldStates();
    const edited = state.update({
      changes: {
        from: doc.indexOf("1"),
        to: doc.indexOf("1") + 1,
        insert: "2",
      },
    }).state;
    const widgets = [...iterWidgets(edited.field(blockWidgetField))];
    expect(
      widgets.some((w) => (w as { mathml?: string }).mathml?.includes("2")),
    ).toBe(true);
  });
});

function* iterWidgets(set: ReturnType<EditorState["field"]>) {
  const cursor = (
    set as {
      iter: () => {
        value: { spec: { widget?: object } } | null;
        next: () => void;
      };
    }
  ).iter();
  while (cursor.value) {
    if (cursor.value.spec.widget) yield cursor.value.spec.widget;
    cursor.next();
  }
}
