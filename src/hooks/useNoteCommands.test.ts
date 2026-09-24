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

describe("useNoteCommands", () => {
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
