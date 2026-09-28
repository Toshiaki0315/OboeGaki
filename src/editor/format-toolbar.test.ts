// 書式ツールバー（B-1）の台帳の検証。押したときの変換そのものは
// format-commands のテストが見る。ここが見るのは「並び・呼び名・ヒント」。

import { describe, expect, test } from "vitest";
import { FORMAT_KEYS } from "./format-commands";
import { FORMAT_TOOLBAR, formatHint, nativeKey } from "./format-toolbar";

describe("nativeKey", () => {
  test("登録の形（Mod-b）を見せる形（⌘B）に直す", () => {
    expect(nativeKey("Mod-b")).toBe("⌘B");
    expect(nativeKey("Mod-Shift-x")).toBe("⌘⇧X");
    expect(nativeKey("Mod-Alt-t")).toBe("⌘⌥T");
  });

  test("記号のキーもそのまま読める形にする", () => {
    expect(nativeKey("Mod-/")).toBe("⌘/");
  });
});

describe("formatHint", () => {
  test("ショートカットがあれば添える（覚えていなくても押せて、覚えられる）", () => {
    expect(formatHint({ kind: "strong", label: "太字" })).toBe("太字（⌘B）");
  });

  test("ショートカットが無いものは呼び名だけ", () => {
    expect(formatHint({ kind: "heading", label: "見出し" })).toBe("見出し");
  });
});

describe("FORMAT_TOOLBAR", () => {
  const items = FORMAT_TOOLBAR.flat();

  test("並びは 文字の装飾 → 行の書式 → 差し込むもの の 3 群", () => {
    // 押す頻度の順ではなく種類でまとめる（目で探すとき固まっていると早い）
    expect(
      FORMAT_TOOLBAR.map((group) => group.map((item) => item.kind)),
    ).toEqual([
      ["strong", "emphasis", "strike", "code", "highlight"],
      // 寄せ（ADR-0069 の決定 5）は行の書式の群の最後
      ["heading", "bullet", "ordered", "checkbox", "quote", "center", "right"],
      ["link", "table"],
    ]);
  });

  test("test_寄せのボタンは呼び名で見分けられ_絵も違う（要望 2026-09-28）", () => {
    const center = items.find((item) => item.kind === "center");
    const right = items.find((item) => item.kind === "right");
    expect(center?.label).toBe("中央に寄せる");
    expect(right?.label).toBe("右に寄せる");
    expect(center?.paths).not.toEqual(right?.paths);
  });

  test("同じものを 2 つ置かない", () => {
    expect(new Set(items.map((item) => item.kind)).size).toBe(items.length);
  });

  test("すべてに呼び名がある（アイコンだけなので読み上げと Tips が頼り）", () => {
    for (const item of items) expect(item.label).not.toBe("");
  });

  test("ショートカットの表記は台帳と食い違わない", () => {
    // **2 通りの書き方を持たない。** 見せる形は登録の形から作る
    for (const item of items) {
      const key = FORMAT_KEYS[item.kind as keyof typeof FORMAT_KEYS];
      if (key)
        expect(formatHint(item)).toBe(`${item.label}（${nativeKey(key)}）`);
      else expect(formatHint(item)).toBe(item.label);
    }
  });
});
