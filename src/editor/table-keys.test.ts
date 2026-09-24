// 表の中の Enter / Tab（要望 2026-09-15）。プレビューモードでも表を直せる
// ように、行と列を増やす手を鍵に付ける。StateCommand なので DOM 無しで試せる。

import { describe, expect, test, vi } from "vitest";
import { EditorState, type StateCommand } from "@codemirror/state";
import { tableEnter, tableNextCell, tablePrevCell } from "./table-keys";
import { LANG } from "./test-utils";

/// `｜` の位置にカーソルを置いてコマンドを実行する。対象外なら null
function press(command: StateCommand, docWithCursor: string): string | null {
  const anchor = docWithCursor.indexOf("｜");
  if (anchor < 0) throw new Error("カーソル記号 ｜ が無い");
  const doc = docWithCursor.replace("｜", "");
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [LANG],
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

const TABLE = "| 見出し1 | 見出し2 |\n| --- | --- |\n| a | b｜ |\n\n後";

describe("Enter（行を足す）", () => {
  test("test_行の中で_Enter_を押すと下に空の行ができて先頭のセルへ", () => {
    expect(press(tableEnter, TABLE)).toBe(
      "| 見出し1 | 見出し2 |\n| --- | --- |\n| a | b |\n| ｜ |  |\n\n後",
    );
  });

  test("test_見出しの行なら区切り行の下に足す", () => {
    expect(
      press(tableEnter, "| 見出し1｜ | 見出し2 |\n| --- | --- |\n| a | b |\n"),
    ).toBe("| 見出し1 | 見出し2 |\n| --- | --- |\n| ｜ |  |\n| a | b |\n");
  });

  test("test_空の行で_Enter_を押すと表を抜ける（箇条書きと同じ作法）", () => {
    expect(
      press(tableEnter, "| a | b |\n| --- | --- |\n| 1 | 2 |\n| ｜ |  |\n"),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n｜\n");
  });

  test("test_表の外では何もしない", () => {
    expect(press(tableEnter, "本文｜")).toBeNull();
    expect(press(tableEnter, "| a | b｜ |")).toBeNull(); // 区切り行が無ければ表ではない
  });
});

describe("Tab（次のセルへ・最後なら行を足す）", () => {
  test("test_セル末尾の空白に居ても_そのセルとして次へ（列を足さない。21-2）", () => {
    // 整形後の表は `a |` の前に必ず空白があり、クリックで置いたキャレットが踏む
    expect(press(tableNextCell, "| a ｜| b |\n| --- | --- |\n")).toBe(
      "| a | b｜ |\n| --- | --- |\n",
    );
    expect(press(tablePrevCell, "| a | b ｜|\n| --- | --- |\n")).toBe(
      "| a｜ | b |\n| --- | --- |\n",
    );
  });

  test("test_次のセルの末尾へ", () => {
    expect(
      press(tableNextCell, "| a | b |\n| --- | --- |\n| 1｜ | 22 |\n"),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 22｜ |\n");
  });

  test("test_見出しの最後のセルなら列を足す（列は見出しが決める）", () => {
    // 見出しの行末に `|` を打つだけだと、GFM は見出しと区切りの列数が違う表を
    // 表と見なさず、壊れて見える。だから全部の行にまとめて足す
    expect(
      press(tableNextCell, "| a | b｜ |\n| --- | --- |\n| 1 | 2 |\n"),
    ).toBe("| a | b | ｜ |\n| --- | --- | --- |\n| 1 | 2 |  |\n");
  });

  test("test_本体の行では区切りを飛ばさず次の行の先頭へ", () => {
    expect(
      press(
        tableNextCell,
        "| a | b |\n| --- | --- |\n| 1 | 2｜ |\n| 3 | 4 |\n",
      ),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3｜ | 4 |\n");
  });

  test("test_最後の行の最後のセルなら新しい行を足す", () => {
    expect(
      press(tableNextCell, "| a | b |\n| --- | --- |\n| 1 | 2｜ |\n"),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| ｜ |  |\n");
  });

  test("test_Shift_Tab_は前のセルへ_先頭なら上の行の最後へ", () => {
    expect(
      press(tablePrevCell, "| a | b |\n| --- | --- |\n| 1 | 2｜ |\n"),
    ).toBe("| a | b |\n| --- | --- |\n| 1｜ | 2 |\n");
    expect(
      press(tablePrevCell, "| a | b |\n| --- | --- |\n| 1｜ | 2 |\n"),
    ).toBe("| a | b｜ |\n| --- | --- |\n| 1 | 2 |\n");
  });

  test("test_表の外では何もしない", () => {
    expect(press(tableNextCell, "- 項目｜")).toBeNull();
  });
});

describe("列を足す", () => {
  test("test_引用の中の表でも頭を保って列が増える", () => {
    expect(press(tableNextCell, "> | a｜ |\n> | --- |\n> | 1 |\n")).toBe(
      "> | a | ｜ |\n> | --- | --- |\n> | 1 |  |\n",
    );
  });

  test("test_本体の行末で縦棒を打っても表は壊れない（他の行は表を離れたときに揃う）", () => {
    expect(
      press(
        tableNextCell,
        "| a | b |\n| --- | --- |\n| 1 | 2 | 3｜\n| 4 | 5 |\n",
      ),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 | 3\n| 4｜ | 5 |\n");
  });
});

describe("選択があるとき", () => {
  test("test_Enter_は選択を捨てて行を足さない（既定の置き換えに譲る）", () => {
    // input-assist の continueMarkup と同じ作法（選択があれば対象外）
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf("1"), head: doc.indexOf("1") + 1 },
      extensions: [LANG],
    });
    const dispatch = vi.fn();
    expect(tableEnter({ state, dispatch })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
