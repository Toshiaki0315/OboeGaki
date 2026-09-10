import { describe, expect, test } from "vitest";
import { startupAction } from "./startup-note";

// 起動時にどのノートを開くか（要望 2026-09-04 / 2026-09-08 / 2026-09-10）
const notes = [{ path: "/v/b.md" }, { path: "/v/a.md" }];

describe("startupAction", () => {
  test("test_前回のノートが残っていればそれを開く", () => {
    expect(
      startupAction({
        remembered: "/v/a.md",
        notes,
        sorted: notes,
        indexSynced: false,
      }),
    ).toEqual({ kind: "open", path: "/v/a.md", forget: false });
  });
  test("test_前回のノートが無ければ一番上_覚えは捨てる", () => {
    expect(
      startupAction({
        remembered: "/v/gone.md",
        notes,
        sorted: notes,
        indexSynced: false,
      }),
    ).toEqual({ kind: "open", path: "/v/b.md", forget: true });
    expect(
      startupAction({
        remembered: null,
        notes,
        sorted: notes,
        indexSynced: true,
      }),
    ).toEqual({ kind: "open", path: "/v/b.md", forget: false });
  });
  test("test_一覧が空でも索引の同期が済むまでは待つ（索引が育つ前に空と決めない）", () => {
    expect(
      startupAction({
        remembered: null,
        notes: [],
        sorted: [],
        indexSynced: false,
      }),
    ).toEqual({ kind: "wait" });
  });
  test("test_同期が済んでも空なら無題を作る（要望 2026-09-10）", () => {
    expect(
      startupAction({
        remembered: null,
        notes: [],
        sorted: [],
        indexSynced: true,
      }),
    ).toEqual({ kind: "create" });
  });
});
