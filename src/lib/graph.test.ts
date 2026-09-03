// リンクの図（TASKS 4-9 / M-2）。起点からの深さで絞る。

import { describe, expect, test } from "vitest";
import { buildGraph, graphToMermaid } from "./graph";

const links = [
  { from: "会議メモ", to: "日報", relation: "参考文献" },
  { from: "日報", to: "予算", relation: "" },
  { from: "予算", to: "決裁", relation: "" },
  { from: "無関係", to: "別の話", relation: "" },
];

describe("buildGraph", () => {
  test("起点からの深さで絞る（**絞らないと開けない**）", () => {
    const graph = buildGraph("会議メモ", links, { depth: 1 });
    expect(graph.nodes.map((node) => node.title)).toEqual(["会議メモ", "日報"]);
  });

  test("深さを増やすと先まで辿る", () => {
    const graph = buildGraph("会議メモ", links, { depth: 2 });
    expect(graph.nodes.map((node) => node.title)).toEqual([
      "会議メモ",
      "日報",
      "予算",
    ]);
  });

  test("指されている側からも辿る（向きは残す）", () => {
    const graph = buildGraph("日報", links, { depth: 1 });
    expect(graph.nodes.map((node) => node.title).sort()).toEqual(
      ["予算", "日報", "会議メモ"].sort(),
    );
    expect(graph.edges).toContainEqual({
      from: "会議メモ",
      to: "日報",
      relation: "参考文献",
    });
  });

  test("まだ無いノートも点にする（中抜きで描く）", () => {
    const graph = buildGraph("会議メモ", links, { depth: 1 });
    expect(graph.nodes.find((node) => node.title === "日報")?.exists).toBe(
      false,
    );
  });

  test("上限で落としたら**黙って減らさない**", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      from: "起点",
      to: `先 ${index}`,
      relation: "",
    }));
    const graph = buildGraph("起点", many, { depth: 1, maxNodes: 10 });
    expect(graph.nodes.length).toBe(10);
    expect(graph.dropped).toBe(21); // 起点 + 30 - 10
  });

  test("繋がっていないノートは出さない", () => {
    const graph = buildGraph("会議メモ", links, { depth: 3 });
    expect(graph.nodes.map((node) => node.title)).not.toContain("無関係");
  });
});

describe("graphToMermaid", () => {
  test("続柄は矢印の名札にする", () => {
    const graph = buildGraph("会議メモ", links, { depth: 1 });
    const text = graphToMermaid(graph, ["会議メモ"]);
    expect(text).toContain("graph LR");
    expect(text).toContain("|参考文献|");
  });

  test("題名の記号は名札の中で壊れない", () => {
    const graph = buildGraph("a", [{ from: "a", to: 'b"c', relation: "" }], {
      depth: 1,
    });
    const text = graphToMermaid(graph, ["a"]);
    expect(text).not.toContain('"b"c"'); // 引用符がそのまま入らない
  });

  test("起点は目立たせる", () => {
    const graph = buildGraph("会議メモ", links, { depth: 1 });
    expect(graphToMermaid(graph, ["会議メモ"])).toContain("classDef start");
  });
});
