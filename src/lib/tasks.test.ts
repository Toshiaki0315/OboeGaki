import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lineStartOffset, setTaskDone, taskMarkerOf } from "./tasks";

// やること一覧（ADR-0056）。開いているノートの側で使う純関数
describe("lineStartOffset", () => {
  test("test_行番号（0 始まり）から行頭のオフセット", () => {
    expect(lineStartOffset("ab\ncd\nef", 0)).toBe(0);
    expect(lineStartOffset("ab\ncd\nef", 2)).toBe(6);
    expect(lineStartOffset("ab\ncd", 9)).toBeNull();
  });
});

describe("setTaskDone", () => {
  test("test_その行の印だけを書き換える（Rust の set_task_done と同じ）", () => {
    expect(setTaskDone("- [ ] a\n- [ ] b\n", 1, true)).toEqual({
      from: 8,
      to: 15,
      insert: "- [x] b",
    });
    expect(setTaskDone("ただの行", 0, true)).toBeNull();
  });
});

describe("taskMarkerOf: Rust と同じ見本で同じ答えになる（fixtures/task-marker-cases.json）", () => {
  // `- [ ]a`（空白なし）を TS だけが印と見なしていた（棚卸し 2026-09-17）
  const cases: {
    line: string;
    task: { done: boolean; body: string } | null;
  }[] = JSON.parse(
    readFileSync("fixtures/task-marker-cases.json", "utf8"),
  ).cases;
  test.each(cases.map((c) => [c.line, c] as const))("%s", (_line, c) => {
    expect(taskMarkerOf(c.line)).toEqual(c.task);
  });

  test("test_setTaskDone_も同じ規則_空白なしは印にしない", () => {
    expect(setTaskDone("- [ ]a\n", 0, true)).toBeNull();
    expect(setTaskDone("- [ ]\n", 0, true)).toEqual({
      from: 0,
      to: 5,
      insert: "- [x]",
    });
  });
});
