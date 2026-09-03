// `:::note` の囲み（B-3 / Qiita 記法）。

import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { noteContainers, UNKNOWN_NOTE_KIND } from "./note-container";

const of = (doc: string) => noteContainers(Text.of(doc.split("\n")));

describe("noteContainers", () => {
  test("種類ごとに見つける", () => {
    const doc = ":::note info\n本文\n:::\n\n:::note alert\n危険\n:::\n";
    expect(of(doc).map((found) => found.kind)).toEqual(["info", "alert"]);
  });

  test("種類を省いたら info（省略は書き忘れではない）", () => {
    expect(of(":::note\n本文\n:::\n")[0].kind).toBe("info");
  });

  test("**知らない綴りは info に寄せない**（間違いに気づけなくなる）", () => {
    expect(of(":::note warm\n本文\n:::\n")[0].kind).toBe(UNKNOWN_NOTE_KIND);
  });

  test("開きと閉じの行の範囲を持つ（隠すため）", () => {
    const doc = ":::note info\n本文\n:::\n";
    const found = of(doc)[0];
    expect(doc.slice(found.open.from, found.open.to)).toBe(":::note info");
    expect(doc.slice(found.close.from, found.close.to)).toBe(":::");
    expect(doc.slice(found.from, found.to)).toBe(":::note info\n本文\n:::");
  });

  test("閉じが無ければ囲みにしない（以降が全部囲みにならない）", () => {
    expect(of(":::note info\n本文\nつづき\n")).toEqual([]);
  });

  test("行頭から始まるものだけ（字下げはコード例）", () => {
    expect(of("    :::note info\n    本文\n    :::\n")).toEqual([]);
  });

  test("`:::note warn extra` は囲みにしない（2 語まで）", () => {
    expect(of(":::note warn extra\n本文\n:::\n")).toEqual([]);
  });
});
