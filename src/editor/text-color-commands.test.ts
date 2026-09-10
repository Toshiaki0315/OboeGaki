import { describe, expect, test } from "vitest";
import { clearColorEdit, colorEdit } from "./text-color-commands";

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
