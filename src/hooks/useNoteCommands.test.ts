// @vitest-environment jsdom
// 開いているノートと、ノートへの操作（19-4 で App.tsx から切り出した）。
// Tauri は lib/ipc を差し替え、同期は口（NoteSyncPort）を偽物にして見る

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  confirmDialog: vi.fn(),
  createFromTemplate: vi.fn(),
  createNote: vi.fn(),
  dailyNote: vi.fn(),
  deleteForever: vi.fn(),
  emptyTrash: vi.fn(),
  moveNote: vi.fn(),
  pinNote: vi.fn(),
  placeManual: vi.fn(),
  placeMcpManual: vi.fn(),
  readNote: vi.fn(),
  renameNote: vi.fn(),
  restoreNote: vi.fn(),
  trashNote: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { LAST_NOTE_KEY } from "../lib/last-vault";
import {
  useNoteCommands,
  type NoteCommandsInput,
  type NoteSyncPort,
} from "./useNoteCommands";

const mocked = vi.mocked(ipc);

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function port(): NoteSyncPort {
  return {
    flush: vi.fn(async () => {}),
    markOpened: vi.fn(),
    dropPending: vi.fn(),
    adopt: vi.fn(),
    renamed: vi.fn(),
    replaceRange: vi.fn(),
    holdSaves: vi.fn(() => vi.fn()),
  };
}

function input(over: Partial<NoteCommandsInput> = {}): NoteCommandsInput {
  return {
    vaultRoot: "/v",
    currentPath: null,
    notes: [],
    trashCount: 0,
    savedAt: null,
    selectNote: vi.fn(),
    refreshLists: vi.fn(async () => {}),
    sync: port(),
    onStatus: vi.fn(),
    onOpened: vi.fn(),
    editorText: () => undefined,
    defaultFolder: () => "",
    clearSelection: vi.fn(),
    storage: fakeStorage(),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.readNote.mockResolvedValue("# 題\n本文\n");
});

describe("useNoteCommands: 見出しに合わせた改名（21-11）", () => {
  test("test_保存のあと見出しが変わっていたら改名し_選択と予約の書き先を付け替える", async () => {
    mocked.renameNote.mockResolvedValue({
      path: "/v/新.md",
      rewritten: 0,
      failed: [],
    });
    mocked.readNote.mockResolvedValue("# 旧\n本文\n");
    const base = input({
      currentPath: "/v/旧.md",
      editorText: () => "# 新\n本文\n",
    });
    const { result, rerender } = renderHook(
      (props: NoteCommandsInput) => useNoteCommands(props),
      { initialProps: base },
    );
    await act(() => result.current.openNote("/v/旧.md")); // 表示中にする
    await act(async () => {
      rerender({ ...base, savedAt: 1 });
    });
    await vi.waitFor(() =>
      expect(base.selectNote).toHaveBeenCalledWith("/v/新.md"),
    );
    expect(base.sync.renamed).toHaveBeenCalledWith("/v/旧.md", "/v/新.md");
  });

  test("test_B_を押した保存が追従を起動し_B_が先に開いても_選択を戻さない（実機の順序。21-12）", async () => {
    let finishRename: (outcome: {
      path: string;
      rewritten: number;
      failed: string[];
    }) => void = () => {};
    mocked.renameNote.mockImplementation(
      () => new Promise((resolve) => (finishRename = resolve)),
    );
    let finishReadB: (text: string) => void = () => {};
    mocked.readNote.mockImplementation((_root, path) =>
      path === "/v/b.md"
        ? new Promise<string>((resolve) => (finishReadB = resolve))
        : Promise.resolve("# 旧\n本文\n"),
    );
    const base = input({
      currentPath: "/v/旧.md",
      editorText: () => "# 新\n本文\n",
    });
    const { result, rerender } = renderHook(
      (props: NoteCommandsInput) => useNoteCommands(props),
      { initialProps: base },
    );
    // まず A（旧）を開いておく
    await act(() => result.current.openNote("/v/旧.md"));
    (base.selectNote as ReturnType<typeof vi.fn>).mockClear();
    // B を押す: 「開く」が世代を進め、A の未保存分を書き切る
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = result.current.openNote("/v/b.md");
    });
    // その保存で savedAt が進み、見出し追従が改名を始める（まだ A を表示中）
    await act(async () => {
      rerender({ ...base, savedAt: 1 });
    });
    await vi.waitFor(() => expect(mocked.renameNote).toHaveBeenCalled());
    // B が先に開き終える
    await act(async () => {
      finishReadB("# B\n");
      await opening;
    });
    expect(base.selectNote).toHaveBeenLastCalledWith("/v/b.md");
    // 遅れて改名が返る
    await act(async () => {
      finishRename({ path: "/v/新.md", rewritten: 0, failed: [] });
    });
    expect(base.selectNote).not.toHaveBeenCalledWith("/v/新.md");
    expect(base.selectNote).toHaveBeenLastCalledWith("/v/b.md");
  });

  test("test_同じノートを開き直す読み込みの間に改名が済んだら_新しいパスで開く（21-13）", async () => {
    mocked.readNote.mockResolvedValue("# 旧\n本文\n");
    const base = input({
      currentPath: "/v/旧.md",
      editorText: () => "# 新\n本文\n",
    });
    const { result, rerender } = renderHook(
      (props: NoteCommandsInput) => useNoteCommands(props),
      { initialProps: base },
    );
    await act(() => result.current.openNote("/v/旧.md"));
    let finishRename: (outcome: {
      path: string;
      rewritten: number;
      failed: string[];
    }) => void = () => {};
    mocked.renameNote.mockImplementation(
      () => new Promise((resolve) => (finishRename = resolve)),
    );
    let finishRead: (text: string) => void = () => {};
    mocked.readNote.mockImplementation(
      () => new Promise<string>((resolve) => (finishRead = resolve)),
    );
    // 見出し追従が改名を始める
    await act(async () => {
      rerender({ ...base, savedAt: 1 });
    });
    await vi.waitFor(() => expect(mocked.renameNote).toHaveBeenCalled());
    // 同じノートを開き直す（クイックオープン）。読み込みは改名の前に済んだが、
    // 応答は改名より後に返る
    let reopening: Promise<void> = Promise.resolve();
    act(() => {
      reopening = result.current.openNote("/v/旧.md");
    });
    await vi.waitFor(() => expect(mocked.readNote).toHaveBeenCalledTimes(2));
    await act(async () => {
      finishRename({ path: "/v/新.md", rewritten: 0, failed: [] });
    });
    await act(async () => {
      finishRead("# 新\n本文\n");
      await reopening;
    });
    // 旧パスで開き直さない（開くと旧パスへ書いて旧ファイルが蘇る）
    expect(base.selectNote).toHaveBeenLastCalledWith("/v/新.md");
    expect(base.sync.markOpened).toHaveBeenLastCalledWith({
      path: "/v/新.md",
      text: "# 新\n本文\n",
    });
  });

  test("test_開き直しの間に改名が輪になっても_最新の位置で開く（21-14）", async () => {
    mocked.readNote.mockResolvedValue("# A\n本文\n");
    const heading = { current: "# B\n本文\n" };
    const base = input({
      currentPath: "/v/A.md",
      editorText: () => heading.current,
    });
    const { result, rerender } = renderHook(
      (props: NoteCommandsInput) => useNoteCommands(props),
      { initialProps: base },
    );
    await act(() => result.current.openNote("/v/A.md"));
    // 開き直しの読み込みを止めておく
    let finishRead: (text: string) => void = () => {};
    mocked.readNote.mockImplementation(
      () => new Promise<string>((resolve) => (finishRead = resolve)),
    );
    let reopening: Promise<void> = Promise.resolve();
    act(() => {
      reopening = result.current.openNote("/v/A.md");
    });
    // その間に見出し追従が A→B→C→B と 3 回改名する
    const hops: [string, string, string][] = [
      ["/v/A.md", "/v/B.md", "# C\n本文\n"],
      ["/v/B.md", "/v/C.md", "# B\n本文\n"],
      ["/v/C.md", "/v/B.md", "# B\n本文\n"],
    ];
    let saved = 1;
    for (const [from, to, next] of hops) {
      mocked.renameNote.mockResolvedValueOnce({
        path: to,
        rewritten: 0,
        failed: [],
      });
      const calls = mocked.renameNote.mock.calls.length;
      await act(async () => {
        rerender({ ...base, currentPath: from, savedAt: saved++ });
      });
      await vi.waitFor(() =>
        expect(mocked.renameNote.mock.calls.length).toBe(calls + 1),
      );
      heading.current = next;
    }
    await act(async () => {
      finishRead("# B\n本文\n");
      await reopening;
    });
    // 実物は B にある（C ではない）
    expect(base.sync.markOpened).toHaveBeenLastCalledWith({
      path: "/v/B.md",
      text: "# B\n本文\n",
    });
  });

  test("test_改名の往復中に別のノートを開いたら_選択を戻さない", async () => {
    let finish: (outcome: {
      path: string;
      rewritten: number;
      failed: string[];
    }) => void = () => {};
    mocked.renameNote.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    mocked.readNote.mockResolvedValue("# B\n");
    const base = input({
      currentPath: "/v/旧.md",
      editorText: () => "# 新\n本文\n",
    });
    const { result, rerender } = renderHook(
      (props: NoteCommandsInput) => useNoteCommands(props),
      { initialProps: base },
    );
    await act(async () => {
      rerender({ ...base, savedAt: 1 });
    });
    await vi.waitFor(() => expect(mocked.renameNote).toHaveBeenCalled());
    // 往復の間に B を開き終える
    await act(() => result.current.openNote("/v/b.md"));
    expect(base.selectNote).toHaveBeenLastCalledWith("/v/b.md");
    await act(async () => {
      finish({ path: "/v/新.md", rewritten: 0, failed: [] });
    });
    // 予約の書き先は付け替えるが、選択は B のまま（A' に戻さない）
    expect(base.sync.renamed).toHaveBeenCalledWith("/v/旧.md", "/v/新.md");
    expect(base.selectNote).not.toHaveBeenCalledWith("/v/新.md");
    expect(base.selectNote).toHaveBeenLastCalledWith("/v/b.md");
  });
});

describe("useNoteCommands", () => {
  test("test_改名は開いている本文を差し替え_エディタは作り直さない（21-4）", async () => {
    mocked.renameNote.mockResolvedValue({
      path: "/v/新.md",
      rewritten: 0,
      failed: [],
    });
    mocked.readNote.mockResolvedValue("# 新\n本文\n");
    const given = input({ currentPath: "/v/旧.md" });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.rename("新"));
    expect(given.sync.adopt).toHaveBeenCalledWith("# 新\n本文\n");
    expect(given.sync.markOpened).toHaveBeenCalledWith({
      path: "/v/新.md",
      text: "# 新\n本文\n",
    });
    expect(result.current.editorSession).toBe(0);
  });

  test("test_改名の往復の間に打った字は消さず_見出しの行だけ差し替える（21-5）", async () => {
    mocked.renameNote.mockResolvedValue({
      path: "/v/新.md",
      rewritten: 0,
      failed: [],
    });
    mocked.readNote.mockResolvedValue("# 新\n本文\n");
    const editorText = vi
      .fn<() => string | undefined>()
      .mockReturnValueOnce("# 旧\n本文\n")
      .mockReturnValue("# 旧\n本文\n打った\n");
    const given = input({ currentPath: "/v/旧.md", editorText });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.rename("新"));
    expect(given.sync.adopt).not.toHaveBeenCalled();
    expect(given.sync.replaceRange).toHaveBeenCalledWith(0, 3, "# 新");
    expect(given.sync.markOpened).toHaveBeenCalledWith({
      path: "/v/新.md",
      text: "# 新\n本文\n",
    });
    // 予約の書き先はファイルが動いた直後に付け替える（旧パスが蘇らない。21-6）
    expect(given.sync.renamed).toHaveBeenCalledWith("/v/旧.md", "/v/新.md");
    const order = (given.sync.renamed as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const replaced = (given.sync.replaceRange as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(order).toBeLessThan(replaced);
  });

  test("test_見出しの無いノートを改名したら_Rust が足した見出しを先頭に差し込む（21-6）", async () => {
    mocked.renameNote.mockResolvedValue({
      path: "/v/新.md",
      rewritten: 0,
      failed: [],
    });
    // Rust の実出力の形（front matter の後ろに見出し。21-7）
    mocked.readNote.mockResolvedValue("---\nid: 1\n---\n# 新\n\n本文\n");
    const editorText = vi
      .fn<() => string | undefined>()
      .mockReturnValueOnce("---\nid: 1\n---\n本文\n")
      .mockReturnValue("---\nid: 1\n---\n本文\n打った\n");
    const given = input({ currentPath: "/v/無題.md", editorText });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.rename("新"));
    expect(given.sync.adopt).not.toHaveBeenCalled();
    expect(given.sync.replaceRange).toHaveBeenCalledWith(14, 14, "# 新\n\n");
    // 改名中は予約を止め、書き先を付け替えてから解く
    expect(given.sync.holdSaves).toHaveBeenCalledTimes(1);
    const release = (given.sync.holdSaves as ReturnType<typeof vi.fn>).mock
      .results[0].value as ReturnType<typeof vi.fn>;
    expect(release).toHaveBeenCalled();
    expect(release.mock.invocationCallOrder[0]).toBeGreaterThan(
      (given.sync.renamed as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    );
  });

  test("test_閉じ区切りで終わる_front_matter_だけのノートでも_本文の先頭に見出しを差し込む（21-7）", async () => {
    mocked.renameNote.mockResolvedValue({
      path: "/v/新.md",
      rewritten: 0,
      failed: [],
    });
    mocked.readNote.mockResolvedValue("---\nid: 1\n---\n# 新\n");
    // 閉じ区切りの直後に打つと front matter のガードが改行を補う（21-2）ので、
    // エディタの本文はこの形になる
    const editorText = vi
      .fn<() => string | undefined>()
      .mockReturnValueOnce("---\nid: 1\n---")
      .mockReturnValue("---\nid: 1\n---\nx");
    const given = input({ currentPath: "/v/無題.md", editorText });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.rename("新"));
    expect(given.sync.replaceRange).toHaveBeenCalledWith(14, 14, "# 新\n\n");
  });

  test("test_改名の往復中に別のノートを開いたら_改名側は選択と本文を触らない（21-5）", async () => {
    let finishRename: (outcome: {
      path: string;
      rewritten: number;
      failed: string[];
    }) => void = () => {};
    mocked.renameNote.mockImplementation(
      () => new Promise((resolve) => (finishRename = resolve)),
    );
    mocked.readNote.mockResolvedValue("# B\n");
    const given = input({ currentPath: "/v/旧.md" });
    const { result } = renderHook(() => useNoteCommands(given));
    const renaming = result.current.rename("新");
    await act(() => result.current.openNote("/v/b.md"));
    await act(async () => {
      finishRename({ path: "/v/新.md", rewritten: 0, failed: [] });
      await renaming;
    });
    expect(given.selectNote).toHaveBeenCalledTimes(1);
    expect(given.selectNote).toHaveBeenCalledWith("/v/b.md");
    expect(given.sync.adopt).not.toHaveBeenCalled();
  });

  test("test_続けて別のノートを開いたら_遅れて解決した前のノートは捨てる（21-3）", async () => {
    let resolveA: (text: string) => void = () => {};
    mocked.readNote.mockImplementation((_root, path) =>
      path.endsWith("a.md")
        ? new Promise<string>((resolve) => (resolveA = resolve))
        : Promise.resolve("# B\n"),
    );
    const given = input();
    const { result } = renderHook(() => useNoteCommands(given));
    const first = result.current.openNote("/v/a.md");
    await act(() => result.current.openNote("/v/b.md"));
    expect(result.current.doc).toBe("# B\n");
    await act(async () => {
      resolveA("# A\n");
      await first;
    });
    expect(result.current.doc).toBe("# B\n");
    expect(given.selectNote).toHaveBeenCalledTimes(1);
    expect(given.selectNote).toHaveBeenCalledWith("/v/b.md");
  });

  test("test_開くと本文を持ち_選択と記憶と同期に知らせ_後始末を呼ぶ", async () => {
    const given = input();
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.openNote("/v/a.md", 3));
    expect(given.sync.flush).toHaveBeenCalled();
    expect(result.current.doc).toBe("# 題\n本文\n");
    expect(result.current.initialCursor).toBe(3);
    expect(result.current.editorSession).toBe(1);
    expect(given.selectNote).toHaveBeenCalledWith("/v/a.md");
    expect(given.sync.markOpened).toHaveBeenCalledWith({
      path: "/v/a.md",
      text: "# 題\n本文\n",
    });
    expect(given.storage!.getItem(LAST_NOTE_KEY)).toContain("a.md");
    expect(given.onOpened).toHaveBeenCalled();
  });

  test("test_読めなければ知らせて何も変えない", async () => {
    mocked.readNote.mockRejectedValue(new Error("gone"));
    const given = input();
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.openNote("/v/a.md"));
    expect(result.current.doc).toBeNull();
    expect(given.onStatus).toHaveBeenCalledWith(
      "開けませんでした: Error: gone",
    );
    expect(given.selectNote).not.toHaveBeenCalled();
  });

  test("test_作ると一覧を引き直してから開く", async () => {
    mocked.createNote.mockResolvedValue("/v/仕事/無題.md");
    const given = input({ defaultFolder: () => "仕事" });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.create());
    expect(mocked.createNote).toHaveBeenCalledWith("/v", "無題", "仕事");
    expect(given.refreshLists).toHaveBeenCalled();
    expect(given.selectNote).toHaveBeenCalledWith("/v/仕事/無題.md");
  });

  test("test_ピン留め中はゴミ箱へ移せない_確認も出さない", async () => {
    const given = input({
      notes: [
        { path: "/v/a.md", label: "a", preview: "", mtimeMs: 0, pinned: true },
      ],
    });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.trash("/v/a.md"));
    expect(mocked.confirmDialog).not.toHaveBeenCalled();
    expect(mocked.trashNote).not.toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenCalledWith(
      "ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）",
    );
  });

  test("test_開いているノートを捨てると予約を捨てて閉じる", async () => {
    mocked.confirmDialog.mockResolvedValue(true);
    mocked.trashNote.mockResolvedValue("/v/.trash/a.md");
    const given = input({ currentPath: "/v/a.md" });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.openNote("/v/a.md"));
    await act(() => result.current.trash());
    expect(given.sync.dropPending).toHaveBeenCalled();
    expect(result.current.doc).toBeNull();
    expect(given.selectNote).toHaveBeenLastCalledWith(null);
    expect(given.storage!.getItem(LAST_NOTE_KEY)).toBeNull();
  });

  test("test_ピンは開いているノートなら本文を受け取り直す", async () => {
    mocked.pinNote.mockResolvedValue("---\npinned: true\n---\n# 題\n");
    const given = input({
      currentPath: "/v/a.md",
      notes: [
        { path: "/v/a.md", label: "a", preview: "", mtimeMs: 0, pinned: false },
      ],
    });
    const { result } = renderHook(() => useNoteCommands(given));
    await act(() => result.current.pin());
    expect(mocked.pinNote).toHaveBeenCalledWith("/v", "/v/a.md", true);
    expect(given.sync.adopt).toHaveBeenCalledWith(
      "---\npinned: true\n---\n# 題\n",
    );
    expect(given.onStatus).toHaveBeenCalledWith("ピン留めしました");
  });
});
