import { describe, expect, test } from "vitest";
import {
  canDropAny,
  draggedNotes,
  encodeNoteDrag,
  parseNoteDrag,
  rangeSelection,
  toggleSelection,
} from "./note-selection";

// ノート一覧の複数選択と、まとめて掴む（要望 2026-09-10）
const order = ["/v/a.md", "/v/b.md", "/v/c.md", "/v/d.md"];

describe("toggleSelection（Cmd+クリック）", () => {
  test("test_無ければ足し_あれば外す", () => {
    const one = toggleSelection(new Set(["/v/a.md"]), "/v/c.md");
    expect([...one]).toEqual(["/v/a.md", "/v/c.md"]);
    expect([...toggleSelection(one, "/v/a.md")]).toEqual(["/v/c.md"]);
  });
});

describe("rangeSelection（Shift+クリック）", () => {
  test("test_起点から押した行までを一覧の並びで選ぶ_逆向きも同じ", () => {
    expect([...rangeSelection(order, "/v/b.md", "/v/d.md")]).toEqual([
      "/v/b.md",
      "/v/c.md",
      "/v/d.md",
    ]);
    expect([...rangeSelection(order, "/v/d.md", "/v/b.md")]).toEqual([
      "/v/b.md",
      "/v/c.md",
      "/v/d.md",
    ]);
  });
  test("test_起点が無い・一覧に無ければ押した行だけ", () => {
    expect([...rangeSelection(order, null, "/v/c.md")]).toEqual(["/v/c.md"]);
    expect([...rangeSelection(order, "/v/gone.md", "/v/c.md")]).toEqual([
      "/v/c.md",
    ]);
  });
});

describe("draggedNotes（掴んだときに動かす対象）", () => {
  test("test_選んでいる行を掴んだら選んでいる全部_一覧の並びで_一覧に無いものは落とす", () => {
    const selected = new Set(["/v/d.md", "/v/a.md", "/v/gone.md"]);
    expect(draggedNotes(order, selected, "/v/a.md")).toEqual([
      "/v/a.md",
      "/v/d.md",
    ]);
  });
  test("test_選んでいない行を掴んだらその行だけ", () => {
    expect(draggedNotes(order, new Set(["/v/a.md"]), "/v/c.md")).toEqual([
      "/v/c.md",
    ]);
  });
});

describe("目印の載せ方", () => {
  test("test_複数は改行で繋ぎ_読むときは空行を捨てる", () => {
    expect(encodeNoteDrag(["/v/a.md", "/v/b.md"])).toBe("/v/a.md\n/v/b.md");
    expect(parseNoteDrag("/v/a.md\n/v/b.md\n")).toEqual(["/v/a.md", "/v/b.md"]);
    expect(parseNoteDrag("")).toEqual([]);
  });
});

describe("canDropAny", () => {
  test("test_1 つでも別のフォルダから来るなら受ける", () => {
    expect(canDropAny("/v", ["/v/仕事/a.md", "/v/b.md"], "仕事")).toBe(true);
    expect(canDropAny("/v", ["/v/仕事/a.md"], "仕事")).toBe(false);
    expect(canDropAny("/v", [], "仕事")).toBe(false);
  });
});
