// Cmd+クリックの判定（ADR-0010/0011、参照実装 core/activation.py の移植）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { activationAt } from "./activation";

function at(doc: string, pos: number) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
  });
  return activationAt(state, pos);
}

describe("activationAt", () => {
  test("タグの上では絞り込み（名前は小文字に正規化）", () => {
    const doc = "本文の #Work/会議 です";
    const pos = doc.indexOf("#") + 2;
    expect(at(doc, pos)).toEqual({ kind: "tag", payload: "work/会議" });
  });

  test("範囲は [start, end)。終端の次の文字では発火しない", () => {
    const doc = "本文の #タグ です";
    const end = doc.indexOf("#") + 3; // "#タグ" の直後
    expect(at(doc, end)).toBeNull();
  });

  test("ノートリンクの上ではノートを開く", () => {
    const doc = "詳細は [[会議メモ]] を見よ";
    expect(at(doc, doc.indexOf("会議メモ") + 1)).toEqual({
      kind: "note",
      payload: "会議メモ",
    });
  });

  test("リンクは http/https/mailto だけ外へ開く", () => {
    const web = "リンクは [説明](https://example.com/a) です";
    expect(at(web, web.indexOf("説明"))).toEqual({
      kind: "link",
      payload: "https://example.com/a",
    });
    const mail = "宛先は [連絡](mailto:a@example.com) へ";
    expect(at(mail, mail.indexOf("連絡"))).toEqual({
      kind: "link",
      payload: "mailto:a@example.com",
    });
    const relative = "添付は [図](attachments/a.png) にある";
    expect(at(relative, relative.indexOf("図"))).toBeNull();
  });

  test("オートリンクも開ける", () => {
    const doc = "そのまま <https://example.com> と書く";
    expect(at(doc, doc.indexOf("example"))).toEqual({
      kind: "link",
      payload: "https://example.com",
    });
  });

  test("画像とただの本文では何もしない", () => {
    const image = "![図](https://example.com/a.png) の上";
    expect(at(image, image.indexOf("図"))).toBeNull();
    expect(at("ただの本文です", 3)).toBeNull();
  });
});
