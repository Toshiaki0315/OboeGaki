import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  completeMatching,
  lineStartOffset,
  setTaskDone,
  taskMarkerOf,
} from "./tasks";

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

// 一覧の行番号は索引（保存後）の写し。開いているノートは保存前の字が先に進んで
// いることがあるので、文も突き合わせる（Rust の complete_matching と同じ答え。
// レビュー 2026-09-27: 開いているノートの道だけ行番号しか見ていなかった）
describe("completeMatching", () => {
  test("test_行番号と文が合えば印を書き換える", () => {
    expect(
      completeMatching("# 題\n\n- [ ] 買い物\n- [ ] 掃除\n", 2, "買い物"),
    ).toEqual({
      kind: "edit",
      edit: { from: 5, to: 14, insert: "- [x] 買い物" },
    });
  });

  test("test_上に行が挟まって別のやることを指していたら触らない", () => {
    const shifted = "# 題\n追加\n\n- [ ] 買い物\n- [ ] 掃除\n";
    // 行 3 は「掃除」ではなく「買い物」— 一覧の「掃除」を押しても書き換えない
    expect(completeMatching(shifted, 3, "掃除")).toEqual({ kind: "mismatch" });
    // やることでない行
    expect(completeMatching(shifted, 1, "買い物")).toEqual({
      kind: "mismatch",
    });
    // 行が無い
    expect(completeMatching(shifted, 99, "買い物")).toEqual({
      kind: "mismatch",
    });
  });

  test("test_既に完了している行は_ずれではない", () => {
    expect(completeMatching("- [x] 済み\n", 0, "済み")).toEqual({
      kind: "done",
    });
  });

  test("test_文は前後の空白を落として比べる（Rust の body.trim と同じ）", () => {
    expect(completeMatching("- [ ]   余白  \n", 0, "余白").kind).toBe("edit");
  });

  test("test_コードフェンスの中の行は_やることとして扱わない", () => {
    const fenced = "```\n- [ ] 例\n```\n";
    expect(completeMatching(fenced, 1, "例")).toEqual({ kind: "mismatch" });
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
