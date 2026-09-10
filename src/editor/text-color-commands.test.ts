import { describe, expect, test } from "vitest";
import { clearColorEdit, colorEdit, colorEdits } from "./text-color-commands";

// 文字色の付け外し（ADR-0061 決定 3）。純関数で試し、EditorView への
// 適用は Editor の applyColor が担う
describe("colorEdit", () => {
  test("test_選択範囲を span で包む", () => {
    const doc = "これは大事です";
    expect(colorEdit(doc, 3, 5, "#e53935")).toEqual({
      from: 3,
      to: 5,
      insert: '<span style="color: #e53935">大事</span>',
    });
  });
  test("test_既に色の span の中身をちょうど選んでいたら色だけ差し替える", () => {
    const doc = 'a <span style="color: red">大事</span> b';
    const inner = doc.indexOf("大事");
    expect(colorEdit(doc, inner, inner + 2, "#1e88e5")).toEqual({
      from: 2,
      to: doc.indexOf(" b"),
      insert: '<span style="color: #1e88e5">大事</span>',
    });
  });
  test("test_選択が無ければ何もしない", () => {
    expect(colorEdit("abc", 1, 1, "#e53935")).toBeNull();
  });
});

describe("clearColorEdit", () => {
  test("test_中身を選んでいるか中にカーソルがあれば包みを外す", () => {
    const doc = 'a <span style="color: red">大事</span> b';
    const inner = doc.indexOf("大事");
    expect(clearColorEdit(doc, inner + 1, inner + 1)).toEqual({
      from: 2,
      to: doc.indexOf(" b"),
      insert: "大事",
    });
  });
  test("test_色以外の属性が混じった span は触らない_span の外でも何もしない", () => {
    const other = 'a <span style="color: red; font-size: 2em">大事</span>';
    expect(
      clearColorEdit(other, other.indexOf("大事"), other.indexOf("大事")),
    ).toBeNull();
    expect(clearColorEdit("abc", 1, 1)).toBeNull();
  });
});

// 複数行・ブロックの印を含む選択（実機 2026-09-11: 見出しと段落をまたいで
// 選ぶと 1 つの span になり、選択の水色が「背景に色が付いた」に見えた）
describe("colorEdits", () => {
  test("test_1 つの選択なら 1 つの span_選択は中の文字だけに置く（続けて選べば色が差し替わる）", () => {
    const doc = "これは大事です";
    expect(colorEdits(doc, 3, 5, "#e53935")).toEqual({
      changes: [
        { from: 3, to: 5, insert: '<span style="color: #e53935">大事</span>' },
      ],
      selection: {
        anchor: 3 + '<span style="color: #e53935">'.length,
        head: 3 + '<span style="color: #e53935">'.length + 2,
      },
    });
  });
  test("test_空行をまたぐ選択は段落ごとに包む（インラインの HTML は段落を越えられない）", () => {
    const doc = "無題\n\nああ";
    const result = colorEdits(doc, 0, doc.length, "#e53935")!;
    expect(result.changes).toEqual([
      { from: 0, to: 2, insert: '<span style="color: #e53935">無題</span>' },
      { from: 4, to: 6, insert: '<span style="color: #e53935">ああ</span>' },
    ]);
  });
  test("test_行頭のブロックの印（# や - ）は包みの外に置く", () => {
    const doc = "# 無題\n- 項目";
    const result = colorEdits(doc, 0, doc.length, "#e53935")!;
    expect(result.changes).toEqual([
      { from: 2, to: 4, insert: '<span style="color: #e53935">無題</span>' },
      { from: 7, to: 9, insert: '<span style="color: #e53935">項目</span>' },
    ]);
  });
  test("test_選択が無い・中身が空白だけなら null", () => {
    expect(colorEdits("abc", 1, 1, "#e53935")).toBeNull();
    expect(colorEdits("a  b", 1, 3, "#e53935")).toBeNull();
  });
});
