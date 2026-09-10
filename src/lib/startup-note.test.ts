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
        emptyOnDisk: null,
      }),
    ).toEqual({ kind: "open", path: "/v/a.md", forget: false });
  });
  test("test_前回のノートが無ければ一番上_覚えは捨てる", () => {
    expect(
      startupAction({
        remembered: "/v/gone.md",
        notes,
        sorted: notes,
        emptyOnDisk: null,
      }),
    ).toEqual({ kind: "open", path: "/v/b.md", forget: true });
    expect(
      startupAction({
        remembered: null,
        notes,
        sorted: notes,
        emptyOnDisk: true,
      }),
    ).toEqual({ kind: "open", path: "/v/b.md", forget: false });
  });
  test("test_一覧が空なら_ディスクを見るまで_そして中身があれば索引が育つまで待つ", () => {
    // 開いた直後の一覧は索引から引く。索引が無い vault では中身があっても
    // 空に見えるので、ディスクを見て決める（実機 2026-09-10: 背景同期の合図
    // はリスナー登録より先に飛ぶことがあり、合図待ちでは永遠に待った）
    expect(
      startupAction({
        remembered: null,
        notes: [],
        sorted: [],
        emptyOnDisk: null,
      }),
    ).toEqual({ kind: "ask-disk" });
    expect(
      startupAction({
        remembered: null,
        notes: [],
        sorted: [],
        emptyOnDisk: false,
      }),
    ).toEqual({ kind: "wait" });
  });
  test("test_ディスクにも無ければ無題を作る（要望 2026-09-10）", () => {
    expect(
      startupAction({
        remembered: null,
        notes: [],
        sorted: [],
        emptyOnDisk: true,
      }),
    ).toEqual({ kind: "create" });
  });
});
