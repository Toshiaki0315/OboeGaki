import { describe, expect, test } from "vitest";
import { lineStartOffset, setTaskDone } from "./tasks";

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
