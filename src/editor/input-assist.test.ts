// 入力補助（Enter / Tab、spec §5.5）の検証。StateCommand なので DOM 無しで
// 押した結果の文書とカーソルを検査できる。

import { describe, expect, test } from "vitest";
import { EditorState, type StateCommand } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { continueMarkup, indentListLess, indentListMore } from "./input-assist";

/// `｜` の位置にカーソルを置いてコマンドを実行する。
/// 対象外（false）なら null、実行されたら結果の文書（新カーソル位置に ｜）。
function press(command: StateCommand, docWithCursor: string): string | null {
  const anchor = docWithCursor.indexOf("｜");
  if (anchor < 0) throw new Error("カーソル記号 ｜ が無い");
  const doc = docWithCursor.replace("｜", "");
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ extensions: [relaxedAsterisk, extendedInline, TaskList] }),
    ],
  });
  let result: string | null = null;
  const handled = command({
    state,
    dispatch(tr) {
      const head = tr.newSelection.main.head;
      const text = tr.newDoc.toString();
      result = text.slice(0, head) + "｜" + text.slice(head);
    },
  });
  return handled ? result : null;
}

describe("Enter の入力補助", () => {
  test("箇条書きを継続する", () => {
    expect(press(continueMarkup, "- 項目｜")).toBe("- 項目\n- ｜");
  });

  test("タスクは継続時に必ず未チェックにする", () => {
    expect(press(continueMarkup, "- [x] 済み｜")).toBe("- [x] 済み\n- [ ] ｜");
  });

  test("番号付きは次の番号を振る（以降は振り直さない）", () => {
    expect(press(continueMarkup, "2. 二番目｜\n3. 三番目")).toBe(
      "2. 二番目\n3. ｜\n3. 三番目",
    );
  });

  test("引用を継続する", () => {
    expect(press(continueMarkup, "> 引用｜")).toBe("> 引用\n> ｜");
  });

  test("行の途中の Enter は残りを次の行へ連れて行く", () => {
    expect(press(continueMarkup, "- 前｜後")).toBe("- 前\n- ｜後");
  });

  test("空の項目は改行せず 1 段浅くする（2 段階解除）", () => {
    expect(press(continueMarkup, "  - ｜")).toBe("- ｜");
    expect(press(continueMarkup, "- ｜")).toBe("｜");
  });

  test("空の引用は改行せずマーカーを外す", () => {
    expect(press(continueMarkup, "> ｜")).toBe("｜");
  });

  test("マーカーの内側にカーソルがあるときは何もしない", () => {
    expect(press(continueMarkup, "-｜ 項目")).toBeNull();
  });

  test("段落では何もしない", () => {
    expect(press(continueMarkup, "ただの文｜")).toBeNull();
  });

  test("コードブロックの中は字下げだけを引き継ぐ", () => {
    expect(press(continueMarkup, "```\n    x = 1｜\n```")).toBe(
      "```\n    x = 1\n    ｜\n```",
    );
    // 字下げの途中で改行したときは何もしない
    expect(press(continueMarkup, "```\n  ｜  x = 1\n```")).toBeNull();
    // フェンス内ではリストの補助を発火させない
    expect(press(continueMarkup, "```\n- 項目｜\n```")).toBeNull();
  });
});

describe("Tab の入力補助", () => {
  test("リスト項目を 1 段深くする", () => {
    expect(press(indentListMore, "- 項｜目")).toBe("  - 項｜目");
  });

  test("Shift+Tab はリスト項目を 1 段浅くする", () => {
    expect(press(indentListLess, "  - 項｜目")).toBe("- 項｜目");
    expect(press(indentListLess, "- 項｜目")).toBeNull(); // これ以上浅くならない
  });

  test("番号付きとタスクにも効く", () => {
    expect(press(indentListMore, "1. 番号｜")).toBe("  1. 番号｜");
    expect(press(indentListMore, "- [ ] やる｜")).toBe("  - [ ] やる｜");
  });

  test("リスト行以外では何もしない（通常のタブ挿入に任せる）", () => {
    expect(press(indentListMore, "ただの文｜")).toBeNull();
    expect(press(indentListMore, "```\n- 中身｜\n```")).toBeNull();
  });
});
