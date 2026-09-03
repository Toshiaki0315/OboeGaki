// Mermaid 図の素材集め（TASKS 4-2 / ADR-0021）。
// 実際の描画は DOM が要るので、ここでは純関数だけを見る。

import { describe, expect, test } from "vitest";
import { cacheKey, collectMermaid } from "./mermaid";

describe("collectMermaid", () => {
  test("フェンスの中身を出てくる順に返す", () => {
    const text = [
      "本文",
      "```mermaid",
      "graph TD;",
      "  A-->B;",
      "```",
      "",
      "```mermaid",
      "pie title 円",
      "```",
      "",
    ].join("\n");
    expect(collectMermaid(text)).toEqual([
      "graph TD;\n  A-->B;",
      "pie title 円",
    ]);
  });

  test("他の言語のフェンスは拾わない", () => {
    const text = "```js\nlet a = 1;\n```\n";
    expect(collectMermaid(text)).toEqual([]);
  });

  test("閉じの無いフェンスは図にしない", () => {
    const text = "```mermaid\ngraph TD;\n";
    expect(collectMermaid(text)).toEqual([]);
  });

  test("中身が空なら拾わない", () => {
    expect(collectMermaid("```mermaid\n\n```\n")).toEqual([]);
  });

  test("`~~~` のフェンスも拾う", () => {
    expect(collectMermaid("~~~mermaid\ngraph TD;\n~~~\n")).toEqual([
      "graph TD;",
    ]);
  });
});

describe("cacheKey", () => {
  test("テーマが違えば別の図として覚える", () => {
    // 含めないと、ダークに切り替えても明るい図が残る
    expect(cacheKey("light", "graph TD;")).not.toBe(
      cacheKey("dark", "graph TD;"),
    );
  });
});
