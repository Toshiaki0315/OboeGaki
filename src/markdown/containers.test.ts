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
      { kind: "note", open: 0, close: 2, info: "warn", form: "colon" },
      { kind: "details", open: 4, close: 6, info: "詳しく", form: "colon" },
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
    expect(found).toEqual([
      { kind: "note", open: 0, close: 4, info: "", form: "colon" },
    ]);
  });

  test("test_コードの行は開きにも閉じにも数えない", () => {
    const text = ":::note\n```\n:::\n```\n:::";
    const code = new Set([1, 2, 3]);
    expect(colonContainers(lines(text), (index) => code.has(index))).toEqual([
      { kind: "note", open: 0, close: 4, info: "", form: "colon" },
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
      { kind: "center", open: 0, close: 2, info: "", form: "colon" },
      { kind: "right", open: 4, close: 6, info: "", form: "colon" },
    ]);
  });

  test("test_知らない綴りと語の付いた寄せは囲みにしない", () => {
    for (const open of [":::centre", ":::中央", ":::left", ":::center 題"]) {
      expect(colonContainers(lines(`${open}\nx\n:::`)), open).toEqual([]);
    }
  });

  test("test_寄せと_note_は互いの中で囲みにしない（入れ子を許さない。決定 3）", () => {
    expect(colonContainers(lines(":::note\n:::center\n文\n:::\n:::"))).toEqual([
      { kind: "note", open: 0, close: 3, info: "", form: "colon" },
    ]);
    expect(colonContainers(lines(":::right\n:::note\n文\n:::\n:::"))).toEqual([
      { kind: "right", open: 0, close: 3, info: "", form: "colon" },
    ]);
  });

  test("test_行は配列でなくても順に読めればよい（エディタの行の走査をそのまま渡す）", () => {
    function* rows() {
      yield ":::center";
      yield "題";
      yield ":::";
    }
    expect(colonContainers(rows())).toEqual([
      { kind: "center", open: 0, close: 2, info: "", form: "colon" },
    ]);
  });

  describe("寄せの HTML を読むときだけ受ける（23-2 / ADR-0069 の決定 6）", () => {
    test("test_開きと閉じが別の行の_div_と_p_を寄せの囲みとして読む", () => {
      const html = (open: string, close: string) =>
        colonContainers(lines(`${open}\n題\n${close}`));
      expect(html('<div align="center">', "</div>")).toEqual([
        { kind: "center", open: 0, close: 2, info: "", form: "html" },
      ]);
      expect(html("<p align='right'>", "</p>")[0]?.kind).toBe("right");
      expect(html('<div style="text-align: center;">', "</div>")[0]?.kind).toBe(
        "center",
      );
      expect(html('<DIV ALIGN="CENTER">', "</DIV>")[0]?.kind).toBe("center");
    });

    test("test_決めた形でないものは受けない", () => {
      for (const open of [
        '<div align="left">',
        '<div align="center" class="x">',
        '<span align="center">',
        '  <div align="center">',
        '<div style="color: red">',
      ]) {
        expect(colonContainers(lines(`${open}\n題\n</div>`)), open).toEqual([]);
      }
      // 閉じのタグが違えば閉じない
      expect(colonContainers(lines('<div align="center">\n題\n</p>'))).toEqual(
        [],
      );
    });

    test("test_入れ子は許さない_HTML_の寄せの中の_:::_では閉じない", () => {
      expect(
        colonContainers(
          lines(':::note\n<div align="center">\n題\n</div>\n:::'),
        ),
      ).toEqual([{ kind: "note", open: 0, close: 4, info: "", form: "colon" }]);
      expect(
        colonContainers(lines('<div align="center">\n:::\n題\n</div>')),
      ).toEqual([
        { kind: "center", open: 0, close: 3, info: "", form: "html" },
      ]);
    });

    test("test_1_行の形は同じ行に開きと閉じを持ち_中身の位置を返す（23-2 後半）", () => {
      const line = '<p align="center">題と**強調**</p>';
      expect(colonContainers(lines(`前\n${line}\n後`))).toEqual([
        {
          kind: "center",
          open: 1,
          close: 1,
          info: "",
          form: "html",
          inline: { from: line.indexOf("題"), to: line.indexOf("</p>") },
        },
      ]);
      expect(
        colonContainers(lines('<div style="text-align: right">署名</div>'))[0]
          ?.kind,
      ).toBe("right");
    });

    test("test_1_行の形でも_中身が空・タグ違い・開いている囲みの中は受けない", () => {
      for (const text of [
        '<p align="center"></p>',
        '<p align="center">題</div>',
        '<p align="center" class="x">題</p>',
      ]) {
        expect(colonContainers(lines(text)), text).toEqual([]);
      }
      expect(
        colonContainers(lines(':::note\n<p align="center">題</p>\n:::')),
      ).toEqual([{ kind: "note", open: 0, close: 2, info: "", form: "colon" }]);
    });
  });
});
