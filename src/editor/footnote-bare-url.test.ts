// 脚注 [^1] の装飾と裸 URL のリンク化（TASKS 2-5、B-3 / inline_scanner）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { activationAt } from "./activation";
import { LANG } from "./test-utils";

function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [LANG],
  });
}

function nodesOf(doc: string, name: string): [number, number][] {
  const state = stateOf(doc);
  const found: [number, number][] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) found.push([node.from, node.to]);
    },
  });
  return found;
}

describe("脚注 [^label]", () => {
  test("test_参照をノードとして拾う", () => {
    const doc = "本文[^1]と[^note]がある";
    expect(nodesOf(doc, "FootnoteRef")).toEqual([
      [2, 6],
      [7, 14],
    ]);
  });

  test("test_ラベルに空白や角括弧は入らない", () => {
    expect(nodesOf("これは[^a b]違う", "FootnoteRef")).toEqual([]);
    expect(nodesOf("これは[^]空", "FootnoteRef")).toEqual([]);
  });

  test("test_ふつうのリンクは今まで通りリンクのまま", () => {
    const doc = "[説明](https://example.com)";
    expect(nodesOf(doc, "FootnoteRef")).toEqual([]);
    expect(nodesOf(doc, "Link").length).toBe(1);
  });
});

describe("裸 URL", () => {
  test("test_httpsのURLをノードとして拾う", () => {
    const doc = "見よ https://example.com/a?b=c を";
    expect(nodesOf(doc, "BareURL")).toEqual([
      [3, 3 + "https://example.com/a?b=c".length],
    ]);
  });

  test("test_日本語の句読点や閉じ括弧で止まる", () => {
    // 参照実装 _BARE_URL_RE: 、。 " ' <> [] () は URL に含めない
    expect(nodesOf("https://a.jp/x、続き", "BareURL")).toEqual([[0, 14]]);
    expect(nodesOf("（https://a.jp/x）", "BareURL")).toEqual([[1, 15]]);
  });

  test("test_丸括弧つきのURLは括弧ごと拾う", () => {
    const url = "https://ja.wikipedia.org/wiki/犬_(動物)";
    expect(nodesOf(`資料 ${url} だ`, "BareURL")).toEqual([[3, 3 + url.length]]);
  });

  test("test_単語やパスの続きには反応しない", () => {
    // (?<![\\w/]) — xhttps://… や //https:// は裸 URL ではない
    expect(nodesOf("xhttps://a.jp", "BareURL")).toEqual([]);
    expect(nodesOf("<https://a.jp>", "BareURL")).toEqual([]); // Autolink に任せる
  });

  test("test_Cmdクリックで開ける", () => {
    const doc = "見よ https://example.com を";
    expect(activationAt(stateOf(doc), 8)).toEqual({
      kind: "link",
      payload: "https://example.com",
    });
  });
});

describe("参照実装と意図して違えるもの（棚卸し 2026-09-17）", () => {
  test("test_日本語の字に続く_URL_も拾う（参照実装の \\w は Unicode）", () => {
    // Python の `(?<![\\w/])` は Unicode の単語文字なので「例https://a.jp」を
    // URL にしない。JS の `\\w` は ASCII だけなので拾う。日本語では空白を
    // 挟まずに URL を書くことが多く、こちらのほうが便利なので**意図して**離れる
    expect(nodesOf("例https://a.jp", "BareURL")).toEqual([[1, 13]]);
  });
});
