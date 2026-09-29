// `[[ノート名]]` の補完（E-6、参照実装 core/notelink.py の移植）。

import { describe, expect, test } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import {
  closingTail,
  linkCompletionEdit,
  noteLinkCompletion,
  noteLinkPrefixAt,
} from "./note-link-complete";
import { LANG } from "./test-utils";

describe("noteLinkPrefixAt", () => {
  test("打ちかけのノート名を返す", () => {
    const line = "詳細は [[会議";
    expect(noteLinkPrefixAt(line, line.length)).toBe("会議");
  });

  test("`[[` の直後は空文字（そこで全部の候補を出す）", () => {
    expect(noteLinkPrefixAt("詳細は [[", 9)).toBe("");
  });

  test("カーソルより後ろは見ない", () => {
    // `[[会議メモ` の途中。打った分で絞る
    expect(noteLinkPrefixAt("[[会議メモ", 4)).toBe("会議");
  });

  test("リンクの外なら null", () => {
    expect(noteLinkPrefixAt("ただの本文", 3)).toBeNull();
    expect(noteLinkPrefixAt("[会議", 3)).toBeNull();
  });

  test("閉じたあとは拾わない", () => {
    const line = "[[会議]] のあと";
    expect(noteLinkPrefixAt(line, line.length)).toBeNull();
  });

  test("別名の記法や `[` が入ったら名前ではない", () => {
    expect(noteLinkPrefixAt("[[名前|表", 6)).toBeNull();
    expect(noteLinkPrefixAt("[[[名前", 5)).toBeNull();
  });
});

describe("closingTail", () => {
  test("閉じ `]]` までに残っている名前の長さ", () => {
    expect(closingTail("メモ]] のあと")).toBe(2);
    expect(closingTail("]]")).toBe(0);
  });

  test("閉じが無ければ null（行の残りは名前ではない）", () => {
    expect(closingTail("メモ のあと")).toBeNull();
    expect(closingTail("")).toBeNull();
  });
});

describe("linkCompletionEdit", () => {
  test("開きかけなら閉じまで足して、その外へ出る", () => {
    // "[[会" まで打った状態。from は `[[` の直後
    const edit = linkCompletionEdit("", "会議メモ", 2, 3);
    expect(edit).toEqual({ from: 2, to: 3, insert: "会議メモ]]", anchor: 8 });
  });

  test("閉じたリンクの中なら、残りの名前ごと置き換えて閉じの外へ", () => {
    // `[[会議メモ]]モ]]` に壊れていた回帰（参照実装のコードレビュー指摘）
    const edit = linkCompletionEdit("モ]]", "会議メモ", 2, 4);
    expect(edit).toEqual({ from: 2, to: 5, insert: "会議メモ", anchor: 8 });
  });
});

function complete(
  doc: string,
  pos: number,
  titles: string[],
  composing = false,
) {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [LANG],
  });
  const source = noteLinkCompletion(() => titles);
  const view = { composing } as unknown as EditorView;
  return source(new CompletionContext(state, pos, false, view));
}

describe("noteLinkCompletion", () => {
  const titles = ["会議メモ", "会議メモ 2026", "日報"];

  test("打ちかけの名前を置き換える範囲と候補を返す", () => {
    const doc = "詳細は [[会議";
    const result = complete(doc, doc.length, titles);
    expect(result?.from).toBe(doc.indexOf("[[") + 2); // `[[` は残す
    expect(result?.options.map((option) => option.label)).toEqual([
      "会議メモ",
      "会議メモ 2026",
    ]);
  });

  test("打ったものと同じだけの候補は出さない", () => {
    const doc = "[[日報";
    expect(complete(doc, doc.length, titles)).toBeNull();
  });

  test("変換中とコードの中では出さない", () => {
    const doc = "[[会議";
    expect(complete(doc, doc.length, titles, true)).toBeNull();
    const fenced = "```md\n[[会議";
    expect(complete(fenced, fenced.length, titles)).toBeNull();
  });
});

describe("候補が出たあとに打ってから確定する（24-3）", () => {
  // CM6 は候補が出たあとも打ち続ける間は同じ候補を使い回し（validFor）、確定の
  // ときに**今の**範囲（from, to）を apply に渡す。以前は候補を作った時点の位置と
  // 後ろの字を使っていて、打ち足した字を残したまま差し込み、字を壊した
  function acceptAfterTyping(before: string, cursor: number, typed: string) {
    const state = EditorState.create({
      doc: before,
      selection: { anchor: cursor },
      extensions: [LANG],
    });
    const result = noteLinkCompletion(() => ["会議メモ"])(
      new CompletionContext(state, cursor, false),
    );
    if (!result) throw new Error("候補が出ない");
    const option = result.options.find((o) => o.label === "会議メモ")!;
    // 候補が出たあとに打ち足す
    let now = state.update({
      changes: { from: cursor, insert: typed },
      selection: { anchor: cursor + typed.length },
    }).state;
    const view = {
      get state() {
        return now;
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state;
      },
    } as unknown as EditorView;
    const apply = option.apply as (
      view: EditorView,
      completion: Completion,
      from: number,
      to: number,
    ) => void;
    apply(view, option, result.from, cursor + typed.length);
    return now.doc.toString();
  }

  test("test_開きかけのリンクで打ち足してから確定しても_打った字が残らない", () => {
    expect(acceptAfterTyping("[[会", 3, "議")).toBe("[[会議メモ]]");
  });

  test("test_閉じたリンクの中で打ち足してから確定しても_名前が壊れない", () => {
    expect(acceptAfterTyping("[[会]]", 3, "議")).toBe("[[会議メモ]]");
  });
});
