import { describe, expect, test } from "vitest";
import { diffLines, foldSame } from "./diff";

// 履歴の差分（ADR-0054）。行単位の LCS。語単位の強調はしない
describe("diffLines", () => {
  test("test_足した行と消した行と同じ行を並べる", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });
  test("test_同じ本文なら全部 same_空からは全部 add", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.kind === "same")).toBe(
      true,
    );
    expect(diffLines("", "a\nb")).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });
  test("test_末尾の改行は行として数えない", () => {
    expect(diffLines("a\n", "a\n")).toEqual([{ kind: "same", text: "a" }]);
  });
});

describe("foldSame", () => {
  test("test_同じ行の長い並びは前後 3 行を残して畳む", () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: "same" as const,
        text: `s${i}`,
      })),
      { kind: "add" as const, text: "x" },
    ];
    const folded = foldSame(lines, 3);
    expect(folded[0]).toEqual({ kind: "skip", count: 7 });
    expect(
      folded.slice(1, 4).map((l) => (l.kind === "same" ? l.text : "")),
    ).toEqual(["s7", "s8", "s9"]);
    expect(folded[4]).toEqual({ kind: "add", text: "x" });
  });
  test("test_短い並びは畳まない_変化が無ければ全部畳んで 1 つの skip", () => {
    const short = [
      { kind: "same" as const, text: "a" },
      { kind: "add" as const, text: "b" },
      { kind: "same" as const, text: "c" },
    ];
    expect(foldSame(short, 3)).toEqual(short);
    const none = Array.from({ length: 5 }, (_, i) => ({
      kind: "same" as const,
      text: `${i}`,
    }));
    expect(foldSame(none, 3)).toEqual([{ kind: "skip", count: 5 }]);
  });
});
