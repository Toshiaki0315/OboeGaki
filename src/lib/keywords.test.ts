// 質問から探す語を取り出す（L-2）。期待値は参照実装
// tests/core/test_keywords.py をそのままオラクルにした。

import { describe, expect, test } from "vitest";
import { terms } from "./keywords";

describe("日本語", () => {
  test("test_漢字の並びを拾う", () => {
    expect(terms("予算について何が決まった？")).toEqual(["予算"]);
  });

  test("test_複数拾える", () => {
    expect(terms("会議の議事録はどこ？")).toEqual(["会議", "議事録"]);
  });

  test("test_カタカナの並びを拾う", () => {
    expect(terms("プロジェクトの進捗は？")).toEqual(["プロジェクト", "進捗"]);
  });

  test("test_1文字は拾わない", () => {
    // 「何」「が」で全ノートに当たる。絞れない語は語にしない
    expect(terms("何がどうなった？")).toEqual([]);
  });

  test("test_送り仮名は挟んで繋ぐ", () => {
    expect(terms("買い物のメモ")).toEqual(["買い物", "メモ"]);
  });

  test("test_助詞では繋がない", () => {
    expect(terms("会議の議事録")).toEqual(["会議", "議事録"]);
  });

  test("test_ひらがなだけの語は拾わない", () => {
    expect(terms("それはどうなりましたか")).toEqual([]);
  });
});

describe("そのほか", () => {
  test("test_英字の語を拾う", () => {
    expect(terms("Ollama の設定は？")).toEqual(["Ollama", "設定"]);
  });

  test("test_1文字の英字は拾わない", () => {
    expect(terms("a の話")).toEqual([]);
  });

  test("test_数字の並びも拾う", () => {
    expect(terms("2026 年の予算")).toEqual(["2026", "予算"]);
  });

  test.each(["？", "、", "。", "「", "」", "！"])(
    "test_記号では切る_%s",
    (mark) => {
      expect(terms(`予算${mark}会議`)).toEqual(["予算", "会議"]);
    },
  );
});

describe("形", () => {
  test("test_同じ語は1回だけ", () => {
    expect(terms("予算と予算の話")).toEqual(["予算"]);
  });

  test("test_多すぎる語は絞る", () => {
    // 問い合わせの回数がそのまま増える。上から数語で足りる
    expect(
      terms("予算 会議 議事録 資料 日程 場所 参加者 費用").length,
    ).toBeLessThanOrEqual(4);
  });

  test("test_空なら空", () => {
    expect(terms("   ")).toEqual([]);
  });
});
