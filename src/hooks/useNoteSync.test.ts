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

  test("test_renamed で予約の書き先と既知の本文のパスが新しい方になる（見出しの追従）", async () => {
    // 見出しに合わせて改名したあと、旧パスへ予約が書かれると消したはずの
    // ファイルが蘇る。改名は本文の差し替えではないので予約は生かし、
    // 書き先だけ付け替える
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    act(() => result.current.noteChanged(() => "本文"));
    act(() => result.current.renamed("/v/a.md", "/v/b.md"));
    await tick(800);
    expect(mocked.writeNote).toHaveBeenCalledWith("/v", "/v/b.md", "本文", 60);
    // 書いた本文は新しいパスの既知として覚える（同じ中身のイベントは無視）
    act(() => result.current.noteChanged(() => "本文 2"));
    mocked.readNote.mockResolvedValue("本文");
    await act(async () => external!({ path: "/v/b.md", kind: "modified" }));
    await tick(1);
    expect(result.current.conflict).toBeNull();
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

describe("useNoteSync: 棚卸しレビュー 2026-09-17", () => {
  test("test_外部変更の読み直しに失敗しても知らせるだけで落ちない", async () => {
    // modified の直後に消されたファイルなどで readNote が reject すると、
    // 未処理の reject になって何も表示されなかった
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    mocked.readNote.mockRejectedValue(new Error("gone"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    await tick(1);
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("読み直せませんでした"),
    );
    expect(result.current.conflict).toBeNull();
  });

  test("test_競合の問いはノートを切り替えたら捨てる（別のノートに外の本文を入れない）", async () => {
    const given = input();
    const { result, rerender } = renderHook(
      (props: NoteSyncInput) => useNoteSync(props),
      {
        initialProps: given,
      },
    );
    act(() => result.current.noteChanged(() => "編集中"));
    await act(async () => external!({ path: "/v/a.md", kind: "modified" }));
    expect(result.current.conflict).not.toBeNull();
    rerender(input({ currentPath: "/v/b.md", replaceText: given.replaceText }));
    expect(result.current.conflict).toBeNull();
    // 万一残っていても、別のノートの本文は差し替えない
    await act(async () => result.current.resolveConflict("external"));
    expect(given.replaceText).not.toHaveBeenCalled();
  });

  test("test_復元に失敗しても知らせて_もう一度選べる", async () => {
    // setRecovery(0) を先にしてから restoreRecovery が reject → ダイアログは
    // 消え、退避は残り、何も表示されなかった
    mocked.pendingRecovery.mockResolvedValue([
      { source: "a.md", text: "x", stashed_at_ms: 1 },
    ]);
    mocked.restoreRecovery.mockRejectedValue(new Error("disk"));
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    await tick(1);
    await act(() => result.current.handleRecovery(true));
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("復元できませんでした"),
    );
    expect(result.current.recovery).toBe(1);
  });

  test("test_前のノートの遅い保存が_今のノートの既知の本文を上書きしない", async () => {
    // A を打って保存中に B を開く → A の保存が終わる → B に「開いた時と同じ
    // 中身」の外部イベント（同期ソフトの触り直し）が来ても聞かない、が
    // known が 1 つしか無く A で上書きされて偽の競合が出ていた
    let finishA: (() => void) | null = null;
    mocked.writeNote.mockImplementation(
      () => new Promise<void>((done) => (finishA = done)),
    );
    const given = input();
    const { result, rerender } = renderHook(
      (props: NoteSyncInput) => useNoteSync(props),
      {
        initialProps: given,
      },
    );
    act(() => result.current.noteChanged(() => "A の本文"));
    await tick(800); // A の保存が始まる（まだ終わらない）
    rerender(input({ currentPath: "/v/b.md" }));
    act(() =>
      result.current.markOpened({ path: "/v/b.md", text: "B を開いた" }),
    );
    act(() => result.current.noteChanged(() => "B を編集"));
    await act(async () => {
      finishA?.();
    });
    mocked.readNote.mockResolvedValue("B を開いた");
    await act(async () => external!({ path: "/v/b.md", kind: "modified" }));
    expect(result.current.conflict).toBeNull();
  });
});

describe("useNoteSync: 改名中の保留（21-7）", () => {
  test("test_保留中は予約が発火せず_解除したら書き先を付け替えたパスへ書く", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "打った"));
    await tick(2000);
    expect(mocked.writeNote).not.toHaveBeenCalled();
    act(() => result.current.renamed("/v/a.md", "/v/b.md"));
    release();
    await tick(800);
    expect(mocked.writeNote).toHaveBeenCalledWith(
      "/v",
      "/v/b.md",
      "打った",
      60,
    );
  });

  test("test_保留中の_flush_は解除を待ってから書く（打った字を消さない）", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "打った"));
    let flushed = false;
    const waiting = result.current.flush().then(() => {
      flushed = true;
    });
    await tick(100);
    expect(flushed).toBe(false);
    expect(mocked.writeNote).not.toHaveBeenCalled();
    release();
    await act(async () => {
      await waiting;
    });
    expect(mocked.writeNote).toHaveBeenCalledWith(
      "/v",
      "/v/a.md",
      "打った",
      60,
    );
  });
});

describe("useNoteSync: 改名と退避・予約の捨て方（21-8）", () => {
  test("test_改名したら旧パスの退避を捨てる（幽霊ノートを生やさない）", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    // 改名の往復中（保留中）に打つと、保存は走らず退避だけが旧パスで残る
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "v0"));
    await tick(100);
    expect(mocked.stashNote).toHaveBeenCalledWith("/v", "/v/a.md", "v0");
    expect(mocked.discardStash).not.toHaveBeenCalled();
    act(() => result.current.renamed("/v/a.md", "/v/b.md"));
    expect(mocked.discardStash).toHaveBeenCalledWith("/v", "/v/a.md");
    // 保存がまだなので、新パスで退避し直す（落ちても打った字が残る。21-9）
    expect(mocked.stashNote).toHaveBeenLastCalledWith(
      "/v",
      "/v/b.md",
      "いまの本文",
    );
    release();
  });

  test("test_保留中に予約を捨てたら_解除しても蘇らない", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "打った"));
    act(() => result.current.cancel());
    release();
    await tick(2000);
    expect(mocked.writeNote).not.toHaveBeenCalled();
  });
});

describe("useNoteSync: 動いていない改名（21-9）", () => {
  test("test_同じ名前に落ちた改名では退避を捨てない", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "v0"));
    await tick(100);
    expect(mocked.stashNote).toHaveBeenCalledWith("/v", "/v/a.md", "v0");
    act(() => result.current.renamed("/v/a.md", "/v/a.md"));
    expect(mocked.discardStash).not.toHaveBeenCalled();
    release();
  });
});

describe("useNoteSync: 退避の取りこぼし（21-10）", () => {
  test("test_退避を書いている間に改名されたら_書き終えた旧パスの退避も捨てる", async () => {
    let finish: () => void = () => {};
    mocked.stashNote.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const given = input();
    const { result } = renderHook(() => useNoteSync(given));
    const release = result.current.holdSaves();
    act(() => result.current.noteChanged(() => "v0"));
    // 退避はまだ書き終わっていない
    act(() => result.current.renamed("/v/a.md", "/v/b.md"));
    expect(mocked.discardStash).toHaveBeenCalledWith("/v", "/v/a.md");
    await act(async () => {
      finish();
    });
    // 書き終えたあと、もう一度捨てに行く（ディスクに残さない）
    expect(
      mocked.discardStash.mock.calls.filter(([, path]) => path === "/v/a.md")
        .length,
    ).toBe(2);
    release();
  });

  test("test_エディタが別のノートを表示していたら_今の本文で再退避しない", async () => {
    const { result, rerender } = renderHook(
      (props: NoteSyncInput) => useNoteSync(props),
      { initialProps: input() },
    );
    // a.md で打って退避が残る（見出し追従の改名は保存を止めない）
    act(() => result.current.noteChanged(() => "a の本文"));
    await tick(100);
    expect(mocked.stashNote).toHaveBeenCalledWith("/v", "/v/a.md", "a の本文");
    mocked.stashNote.mockClear();
    // 改名の往復中に別のノート（b.md）が開かれた。エディタは b を表示している
    rerender(input({ currentPath: "/v/b.md", readText: () => "b の本文" }));
    act(() => result.current.renamed("/v/a.md", "/v/a2.md"));
    // a の退避は捨てるが、b の本文を a2 の名前で退避しない
    expect(mocked.discardStash).toHaveBeenCalledWith("/v", "/v/a.md");
    expect(mocked.stashNote).not.toHaveBeenCalled();
  });
});
