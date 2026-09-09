// @vitest-environment jsdom
// 自動保存（spec §7.4）・退避（H-1）・外部変更と競合（spec §7.5）・外部削除・
// 前回の未保存（ADR-0049）の検証。Rust への包み（lib/ipc）は差し替える。

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  writeNote: vi.fn(),
  readNote: vi.fn(),
  noteExists: vi.fn(),
  stashNote: vi.fn(),
  discardStash: vi.fn(),
  pendingRecovery: vi.fn(),
  restoreRecovery: vi.fn(),
  clearRecovery: vi.fn(),
  conflictCopy: vi.fn(),
  subscribeVaultChanged: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { useNoteSync, type NoteSyncInput } from "./useNoteSync";

const mocked = vi.mocked(ipc);
type Change = Parameters<Parameters<typeof ipc.subscribeVaultChanged>[0]>[0];
let external: ((change: Change) => void) | null = null;

function input(over: Partial<NoteSyncInput> = {}): NoteSyncInput {
  return {
    vaultRoot: "/v",
    currentPath: "/v/a.md",
    historyMinutes: 60,
    readText: () => "いまの本文",
    replaceText: vi.fn(),
    onStatus: vi.fn(),
    refreshLists: vi.fn(() => Promise.resolve()),
    onCloseNote: vi.fn(),
    onRecovered: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  external = null;
  mocked.subscribeVaultChanged.mockImplementation((handler) => {
    external = handler;
    return () => {
      external = null;
    };
  });
  mocked.writeNote.mockResolvedValue(undefined);
  mocked.stashNote.mockResolvedValue(undefined);
  mocked.discardStash.mockResolvedValue(undefined);
  mocked.pendingRecovery.mockResolvedValue([]);
  mocked.noteExists.mockResolvedValue(true);
  mocked.readNote.mockResolvedValue("外の本文");
});
afterEach(() => vi.useRealTimers());

describe("useNoteSync: 自動保存", () => {
  test("test_打つと未保存_800ms 置いて書き_保存済みと時刻", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "書いた"));
    expect(given.onStatus).toHaveBeenCalledWith("未保存");
    expect(mocked.writeNote).not.toHaveBeenCalled();
    await tick(800);
    expect(mocked.writeNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "書いた",
      60,
    );
    expect(given.onStatus).toHaveBeenLastCalledWith("保存済み");
    expect(result.current.savedAt).not.toBeNull();
  });

  test("test_打ち続けている間は保存が伸び_2 秒おきに退避する（H-1）", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    for (let i = 0; i < 6; i++) {
      act(() => result.current.noteChanged(() => `v${i}`));
      await tick(500);
    }
    expect(mocked.writeNote).not.toHaveBeenCalled();
    expect(mocked.stashNote.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocked.stashNote).toHaveBeenCalledWith("/v", "/v/a.md", "v0");
  });

  test("test_保存できたら退避は捨てる", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "x"));
    await tick(800);
    expect(mocked.discardStash).toHaveBeenCalledWith("/v", "/v/a.md");
  });

  test("test_保存に失敗したら知らせて退避する", async () => {
    mocked.writeNote.mockRejectedValue(new Error("disk"));
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "x"));
    await tick(800);
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("保存に失敗"),
    );
    expect(mocked.stashNote).toHaveBeenCalledWith("/v", "/v/a.md", "x");
  });

  test("test_flush は予約を今すぐ書く", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "x"));
    await act(() => result.current.flush());
    expect(mocked.writeNote).toHaveBeenCalledTimes(1);
  });

  test("test_別のノートへ移ったあとに終わった保存は表示を触らない", async () => {
    let finish: (() => void) | null = null;
    mocked.writeNote.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const given = input();
    const { result, rerender } = renderHook(
      (p: NoteSyncInput) => useNoteSync(p),
      {
        initialProps: given,
      },
    );
    act(() => result.current.noteChanged(() => "x"));
    await tick(800);
    rerender(input({ currentPath: "/v/b.md" }));
    await act(async () => {
      finish!();
      await Promise.resolve();
    });
    expect(given.onStatus).not.toHaveBeenCalledWith("保存済み");
  });

  test("test_markOpened で未編集に戻り_dropPending で予約を捨てる", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "x"));
    act(() => result.current.dropPending());
    await tick(1000);
    expect(mocked.writeNote).not.toHaveBeenCalled();
    act(() => result.current.markOpened());
    expect(result.current.savedAt).toBeNull();
  });
});

describe("useNoteSync: 外部変更（spec §7.5）", () => {
  test("test_未編集なら静かに読み直し_一覧は 300ms まとめて引き直す", async () => {
    const given = input();
    renderHook(() => useNoteSync(given));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(given.replaceText).toHaveBeenCalledWith("外の本文");
    expect(given.refreshLists).not.toHaveBeenCalled();
    await tick(300);
    expect(given.refreshLists).toHaveBeenCalledTimes(1);
  });

  test("test_編集中なら 3 択を出し_予約を捨てて退避する", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "自分の版"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).not.toBeNull();
    expect(result.current.conflict).toEqual({
      path: "/v/a.md",
      externalText: "外の本文",
    });
    expect(given.replaceText).not.toHaveBeenCalled();
    expect(mocked.stashNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "いまの本文",
    );
    await tick(2000);
    expect(mocked.writeNote).not.toHaveBeenCalled();
  });

  test("test_外部の内容が最後に保存した本文と同じなら_編集中でも聞かない（自分の保存の残響・同期ソフトの触り直し）", async () => {
    // 実機 2026-09-09: SVG を貼った直後に打っていると競合の 3 択が出た。
    // 監視のイベントは抑制窓（1.5 秒）を過ぎて届くことがある（iCloud などの
    // 同期が上げ終わったあとにファイルを触り直す）。中身が自分の書いたもの
    // と同じなら、外部の変更ではない
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "自分の版"));
    await tick(800);
    expect(mocked.writeNote).toHaveBeenCalledTimes(1);
    act(() => result.current.noteChanged(() => "自分の版 1"));
    mocked.readNote.mockResolvedValue("自分の版");
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).toBeNull();
    expect(given.replaceText).not.toHaveBeenCalled();
    // 予約は生きている（打ったぶんはあとで書かれる）
    await tick(800);
    expect(mocked.writeNote).toHaveBeenLastCalledWith(
      "/v",
      "/v/a.md",
      "自分の版 1",
      60,
    );
  });

  test("test_開いたときの本文と同じなら_まだ保存していなくても聞かない", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() =>
      result.current.markOpened({ path: "/v/a.md", text: "開いた本文" }),
    );
    act(() => result.current.noteChanged(() => "開いた本文 1"));
    mocked.readNote.mockResolvedValue("開いた本文");
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).toBeNull();
  });

  test("test_未編集で外部の内容が今の本文と同じなら読み直さない（キャレットを動かさない）", async () => {
    const given = input({ readText: () => "同じ本文" });
    renderHook(() => useNoteSync(given));
    mocked.readNote.mockResolvedValue("同じ本文");
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(given.replaceText).not.toHaveBeenCalled();
  });

  test("test_別のノートの変更は一覧だけ", async () => {
    const given = input();
    renderHook(() => useNoteSync(given));
    await act(async () => external!({ path: "/v/other.md", kind: "modified" }));
    await tick(300);
    expect(given.refreshLists).toHaveBeenCalledTimes(1);
    expect(mocked.readNote).not.toHaveBeenCalled();
  });

  test("test_外部の採用は予約を捨てて差し替える", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "自分の版"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).not.toBeNull();
    await act(() => result.current.resolveConflict("external"));
    expect(given.replaceText).toHaveBeenCalledWith("外の本文");
    expect(result.current.conflict).toBeNull();
    expect(mocked.discardStash).toHaveBeenCalledWith("/v", "/v/a.md");
  });

  test("test_自分の版で上書きは必ず今の本文を書く", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "自分の版"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).not.toBeNull();
    await act(() => result.current.resolveConflict("mine"));
    expect(mocked.writeNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "自分の版",
      60,
    );
    expect(given.onStatus).toHaveBeenLastCalledWith("自分の版で上書きしました");
  });

  test("test_両方残すは競合コピーへ書いてから外部の版にする", async () => {
    mocked.conflictCopy.mockResolvedValue("/v/a (競合 2026-09-07).md");
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "自分の版"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).not.toBeNull();
    await act(() => result.current.resolveConflict("both"));
    expect(mocked.conflictCopy).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "いまの本文",
    );
    expect(given.replaceText).toHaveBeenCalledWith("外の本文");
    expect(given.refreshLists).toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("競合"),
    );
  });
});

describe("useNoteSync: 外部削除", () => {
  test("test_本当に無いときだけ聞き_予約を捨てて退避する", async () => {
    mocked.noteExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    await act(async () => external!({ path: "/v/a.md", kind: "removed" }));
    await tick(0);
    expect(result.current.deleted).toBeNull(); // 改名の途中経過は無視
    await act(async () => external!({ path: "/v/a.md", kind: "removed" }));
    await tick(1);
    expect(result.current.deleted).toBe("/v/a.md");
    expect(mocked.stashNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "いまの本文",
    );
  });

  test("test_作り直すと今の本文で書く_閉じるとノートを外す", async () => {
    mocked.noteExists.mockResolvedValue(false);
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    await act(async () => external!({ path: "/v/a.md", kind: "removed" }));
    await tick(1);
    expect(result.current.deleted).toBe("/v/a.md");
    await act(() => result.current.recreateDeleted());
    expect(mocked.writeNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "いまの本文",
      60,
    );
    expect(result.current.deleted).toBeNull();
    await act(async () => external!({ path: "/v/a.md", kind: "removed" }));
    await tick(1);
    expect(result.current.deleted).toBe("/v/a.md");
    act(() => result.current.closeDeleted());
    expect(given.onCloseNote).toHaveBeenCalledTimes(1);
    expect(result.current.deleted).toBeNull();
  });
});

describe("useNoteSync: 前回の未保存（H-1）", () => {
  test("test_開いた vault に退避があれば件数を出す", async () => {
    mocked.pendingRecovery.mockResolvedValue([
      { source: "a.md", text: "x", stashed_at_ms: 1 },
    ]);
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    await tick(1);
    expect(result.current.recovery).toBe(1);
  });

  test("test_復元しないなら捨てる_復元するなら別ファイルにして開く", async () => {
    mocked.pendingRecovery.mockResolvedValue([
      { source: "a.md", text: "x", stashed_at_ms: 1 },
    ]);
    mocked.restoreRecovery.mockResolvedValue(["/v/a (復元).md"]);
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    await tick(1);
    expect(result.current.recovery).toBe(1);
    await act(() => result.current.handleRecovery(false));
    expect(mocked.clearRecovery).toHaveBeenCalledWith("/v");
    expect(result.current.recovery).toBe(0);
    await act(() => result.current.handleRecovery(true));
    expect(mocked.restoreRecovery).toHaveBeenCalledWith("/v");
    expect(given.onRecovered).toHaveBeenCalledWith(["/v/a (復元).md"]);
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("1 件"),
    );
  });
});
