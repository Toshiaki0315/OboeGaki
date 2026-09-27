// `:::` の囲み（`:::note` / `:::details`）を 1 本の走査で見つける（22-P /
// ADR-0069 の決定 3）。画面の note-container / details-container と同じ綴りの規則。

import { describe, expect, test } from "vitest";
import { colonContainers } from "./containers";

const lines = (text: string) => text.split("\n");

describe("colonContainers", () => {
  test("test_note_と_details_を開きと閉じの行で返す", () => {
    const found = colonContainers(
      lines(":::note warn\n注意\n:::\n\n:::details 詳しく\n中身\n:::"),
    );
    expect(found).toEqual([
      { kind: "note", open: 0, close: 2, info: "warn" },
      { kind: "details", open: 4, close: 6, info: "詳しく" },
    ]);
  });

  test("test_閉じの無い開きは囲みにしない", () => {
    expect(colonContainers(lines(":::note\n書きかけ"))).toEqual([]);
  });

  test("test_入れ子は見ない_開いている間の開きは囲みにしない", () => {
    const found = colonContainers(
      lines(":::note\n外\n:::details 内\n中\n:::\n後\n:::"),
    );
    // 最初の `:::` で note が閉じる。`:::details` と最後の `:::` は字のまま
    expect(found).toEqual([{ kind: "note", open: 0, close: 4, info: "" }]);
  });

  test("test_コードの行は開きにも閉じにも数えない", () => {
    const text = ":::note\n```\n:::\n```\n:::";
    const code = new Set([1, 2, 3]);
    expect(colonContainers(lines(text), (index) => code.has(index))).toEqual([
      { kind: "note", open: 0, close: 4, info: "" },
    ]);
  });

  test("test_字下げした行と語の多すぎる_note_は囲みにしない", () => {
    expect(colonContainers(lines("  :::note\nx\n:::"))).toEqual([]);
    expect(colonContainers(lines(":::note warn extra\nx\n:::"))).toEqual([]);
  });

  test("test_center_と_right_を見つける（22-1 / ADR-0069 の決定 1）", () => {
    expect(
      colonContainers(lines(":::center\n題\n:::\n\n:::right\n署名\n:::")),
    ).toEqual([
      { kind: "center", open: 0, close: 2, info: "" },
      { kind: "right", open: 4, close: 6, info: "" },
    ]);
  });

  test("test_知らない綴りと語の付いた寄せは囲みにしない", () => {
    for (const open of [":::centre", ":::中央", ":::left", ":::center 題"]) {
      expect(colonContainers(lines(`${open}\nx\n:::`)), open).toEqual([]);
    }
  });

  test("test_寄せと_note_は互いの中で囲みにしない（入れ子を許さない。決定 3）", () => {
    expect(colonContainers(lines(":::note\n:::center\n文\n:::\n:::"))).toEqual([
      { kind: "note", open: 0, close: 3, info: "" },
    ]);
    expect(colonContainers(lines(":::right\n:::note\n文\n:::\n:::"))).toEqual([
      { kind: "right", open: 0, close: 3, info: "" },
    ]);
  });

  test("test_行は配列でなくても順に読めればよい（エディタの行の走査をそのまま渡す）", () => {
    function* rows() {
      yield ":::center";
      yield "題";
      yield ":::";
    }
    expect(colonContainers(rows())).toEqual([
      { kind: "center", open: 0, close: 2, info: "" },
    ]);
  });
});
