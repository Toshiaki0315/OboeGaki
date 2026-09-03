// front matter の完全隠蔽と編集ガード（TASKS 2-2、ADR-0013）。
// id は ULID による同一性の鍵なので、誤って消せない作りであること。

import { describe, expect, it, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  frontMatterHide,
  frontMatterField,
  frontMatterRange,
  parseFrontMatterMeta,
} from "./frontmatter";

const FM = "---\nid: 01ABC\npinned: true\n---\n";
const DOC = `${FM}# 本文\n`;
const BODY_START = FM.length;

describe("frontMatterRange", () => {
  it("test_先頭の閉じた区切りを見つける", () => {
    const range = frontMatterRange(DOC);
    expect(range).toEqual({
      from: 0,
      to: FM.length - 1, // 閉じ --- の行末（改行の手前）
      bodyStart: BODY_START,
    });
  });

  it("test_1行目でなければ対象外", () => {
    expect(frontMatterRange(`\n${FM}`)).toBeNull();
    expect(frontMatterRange(`x\n${FM}`)).toBeNull();
  });

  it("test_閉じが無ければただの水平線として本文扱い", () => {
    expect(frontMatterRange("---\npinned: true\n")).toBeNull();
  });

  it("test_区切りの後ろの空白は許す", () => {
    expect(frontMatterRange("---  \na: 1\n---\t\n本文")).not.toBeNull();
  });

  it("test_文書全体がfront_matterでも壊れない", () => {
    const solo = "---\na: 1\n---";
    const range = frontMatterRange(solo);
    expect(range?.to).toBe(solo.length);
    expect(range?.bodyStart).toBe(solo.length);
  });

  it("test_front_matterが無ければnull", () => {
    expect(frontMatterRange("# ただの本文\n")).toBeNull();
  });
});

describe("parseFrontMatterMeta", () => {
  it("test_スカラー値を型ごと読む", () => {
    expect(parseFrontMatterMeta(DOC)).toEqual({ id: "01ABC", pinned: true });
  });

  it("test_引用符付き文字列と数値", () => {
    const doc = '---\ntitle: "a: b"\ncount: 3\n---\n';
    expect(parseFrontMatterMeta(doc)).toEqual({ title: "a: b", count: 3 });
  });

  it("test_解釈できない行は黙って飛ばす", () => {
    // メタデータが壊れていても本文は開ける（G3）。落とさないことが第一
    const doc = "---\n: broken\nnested:\n  deep: 1\nid: x\n---\n";
    expect(parseFrontMatterMeta(doc)).toEqual({ id: "x" });
  });

  it("test_front_matterが無ければ空", () => {
    expect(parseFrontMatterMeta("# 本文\n")).toEqual({});
  });
});

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [frontMatterHide] });
}

describe("隠蔽と編集ガード", () => {
  test("test_fieldがfront_matterの範囲を持つ", () => {
    expect(stateOf(DOC).field(frontMatterField)?.bodyStart).toBe(BODY_START);
    expect(stateOf("# 本文\n").field(frontMatterField)).toBeNull();
  });

  test("test_本文の編集で範囲が追従する", () => {
    const state = stateOf(DOC);
    const next = state.update({
      changes: { from: DOC.length, insert: "追記" },
    }).state;
    expect(next.field(frontMatterField)?.bodyStart).toBe(BODY_START);
  });

  test("test_選択はfront_matterへ入れず本文の先頭へ丸める", () => {
    const state = stateOf(DOC);
    const next = state.update({
      selection: EditorSelection.single(0, 4),
      userEvent: "select",
    }).state;
    expect(next.selection.main.from).toBe(BODY_START);
  });

  test("test_backspaceでfront_matterを巻き込めない", () => {
    // 本文先頭で Backspace = 閉じ区切りの改行を消す操作。通すと
    // front matter が本文に化けて id が失われる
    const state = stateOf(DOC);
    const next = state.update({
      changes: { from: BODY_START - 1, to: BODY_START },
      userEvent: "delete.backward",
    }).state;
    expect(next.doc.toString()).toBe(DOC);
  });

  test("test_本文の先頭への入力は通る", () => {
    const state = stateOf(DOC);
    const next = state.update({
      changes: { from: BODY_START, insert: "あ" },
      userEvent: "input.type",
    }).state;
    expect(next.doc.toString()).toBe(`${FM}あ# 本文\n`);
  });

  test("test_プログラムからの全置換は通る", () => {
    // 外部リロード・履歴の書き戻しは userEvent を持たない
    const state = stateOf(DOC);
    const next = state.update({
      changes: { from: 0, to: DOC.length, insert: "全部違う" },
    }).state;
    expect(next.doc.toString()).toBe("全部違う");
    expect(next.field(frontMatterField)).toBeNull();
  });
});

describe("front matter に当たりを含む一括置換（レビュー 2026-09-04）", () => {
  test("test_本文側の置換は生かしfront_matter側だけ落とす", () => {
    // 「すべて置換」は 1 transaction に複数の変更が入る。全体を
    // 破棄すると、本文側の置換まで黙って消える
    const state = EditorState.create({
      doc: DOC, // ---/id: 01ABC/pinned: true/--- + "# 本文"
      extensions: [frontMatterHide],
    });
    const abcInMeta = DOC.indexOf("01ABC");
    const target = DOC.indexOf("本文");
    const next = state.update({
      changes: [
        { from: abcInMeta, to: abcInMeta + 5, insert: "書換" },
        { from: target, to: target + 2, insert: "書換" },
      ],
      userEvent: "input.replace.all",
    }).state;
    expect(next.doc.toString()).toBe(DOC.replace("本文", "書換"));
  });
});
