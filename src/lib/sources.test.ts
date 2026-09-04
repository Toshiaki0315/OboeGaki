// 質問に答える材料の選び方（L-2）。参照実装 core/llm.pack と同じ考え方。

import { describe, expect, it } from "vitest";
import {
  packSources,
  pickSources,
  SOURCE_CHARS,
  SOURCE_LIMIT,
} from "./sources";

const hit = (path: string, title = path) => ({ path, title, snippet: "" });

describe("pickSources", () => {
  it("test_同じノートは一度だけ（語ごとに探すので重なる）", () => {
    const picked = pickSources([hit("a.md"), hit("b.md"), hit("a.md")]);
    expect(picked.map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
  });

  it("test_多すぎる材料は絞る", () => {
    const many = Array.from({ length: 12 }, (_, i) => hit(`${i}.md`));
    expect(pickSources(many)).toHaveLength(SOURCE_LIMIT);
  });

  it("test_当たりが無ければ空", () => {
    expect(pickSources([])).toEqual([]);
  });
});

describe("packSources", () => {
  it("test_1本あたりの長さを抑える", () => {
    // **文脈からあふれると黙って切れる。** 5 本 × 2,000 字で 1 万字
    const long = "あ".repeat(SOURCE_CHARS + 500);
    const packed = packSources([{ title: "長いノート", body: long }]);
    expect([...packed[0][1]].length).toBeLessThanOrEqual(SOURCE_CHARS);
  });

  it("test_題名と本文の組にする", () => {
    expect(packSources([{ title: "会議", body: "予算は据え置き。" }])).toEqual([
      ["会議", "予算は据え置き。"],
    ]);
  });

  it("test_front_matter は外す", () => {
    // 画面に見えていないものを材料に混ぜない
    const body = "---\ntags: [仕事]\n---\n\n本文です。";
    expect(packSources([{ title: "note", body }])[0][1]).toBe("本文です。");
  });
});
