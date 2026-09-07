// @vitest-environment jsdom
// 検索・絞り込み・並び順（ADR-0049 / C-3 / C-4 / K-4 / ADR-0024）の検証。
// 検索・タグ・フォルダは排他 — どれも一覧の中身を差し替える。

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  searchNotes: vi.fn(),
  notesWithTag: vi.fn(),
  notesInFolder: vi.fn(),
}));

import { TRASH_FOLDER } from "../lib/finder";
import * as ipc from "../lib/ipc";
import type { NoteEntry } from "../lib/note-order";
import { useSearch, type SearchInput } from "./useSearch";

const mocked = vi.mocked(ipc);

function note(path: string, mtimeMs = 0, pinned = false): NoteEntry {
  return {
    path: `/v/${path}`,
    label: path.replace(/\.md$/, ""),
    preview: "",
    mtimeMs,
    pinned,
  };
}
const NOTES = [note("b.md", 1), note("a.md", 2)];

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function input(over: Partial<SearchInput> = {}): SearchInput {
  return {
    vaultRoot: "/v",
    notes: NOTES,
    storage: memoryStorage(),
    onStatus: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.searchNotes.mockResolvedValue({ hits: [], unreadable: [] });
  mocked.notesWithTag.mockResolvedValue([]);
  mocked.notesInFolder.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("useSearch", () => {
  test("test_打って 200ms 置いてから探す_結果が並ぶ", async () => {
    vi.useFakeTimers();
    mocked.searchNotes.mockResolvedValue({
      hits: [{ path: "a.md", title: "A", snippet: "…" }],
      unreadable: [],
    });
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.setQuery("予算"));
    expect(mocked.searchNotes).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocked.searchNotes).toHaveBeenCalledWith("/v", "予算");
    expect(result.current.hits).toHaveLength(1);
  });

  test("test_空にしたら結果を消して探しに行かない", async () => {
    vi.useFakeTimers();
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.setQuery("予算"));
    act(() => result.current.setQuery(""));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocked.searchNotes).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);
  });

  test("test_遅い結果が新しい検索語の結果を上書きしない（世代ガード）", async () => {
    vi.useFakeTimers();
    let resolveOld: ((value: ipc.SearchOutcome) => void) | null = null;
    mocked.searchNotes.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    );
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.setQuery("古い"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() => result.current.setQuery("新しい"));
    await act(async () => {
      resolveOld!({
        hits: [{ path: "x.md", title: "古", snippet: "" }],
        unreadable: [],
      });
      await Promise.resolve();
    });
    expect(result.current.hits).toEqual([]);
  });

  test("test_読めない日付は黙って絞りに使わず知らせる", async () => {
    vi.useFakeTimers();
    mocked.searchNotes.mockResolvedValue({
      hits: [],
      unreadable: ["after:きのう"],
    });
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.setQuery("after:きのう"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(given.onStatus).toHaveBeenCalledWith(
      expect.stringContaining("after:きのう"),
    );
  });

  test("test_タグで絞ると検索とフォルダは解け_索引から引く（C-4）", async () => {
    mocked.notesWithTag.mockResolvedValue([note("t.md")]);
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.setQuery("予算"));
    act(() => result.current.filterByFolder("仕事"));
    act(() => result.current.filterByTag("仕事"));
    expect(result.current.query).toBe("");
    expect(result.current.folderFilter).toBeNull();
    expect(result.current.tagFilter).toBe("仕事");
    await waitFor(() =>
      expect(result.current.sortedNotes.map((n) => n.label)).toEqual(["t"]),
    );
    expect(mocked.notesWithTag).toHaveBeenCalledWith("/v", "仕事");
    act(() => result.current.filterByTag(null));
    expect(result.current.sortedNotes).toHaveLength(2);
  });

  test("test_フォルダで絞ると直下だけ_ゴミ箱は索引を引かない", async () => {
    mocked.notesInFolder.mockResolvedValue([note("仕事/f.md")]);
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.filterByFolder("仕事"));
    await waitFor(() =>
      expect(result.current.sortedNotes.map((n) => n.label)).toEqual([
        "仕事/f",
      ]),
    );
    expect(mocked.notesInFolder).toHaveBeenCalledWith("/v", "仕事");
    act(() => result.current.filterByFolder(TRASH_FOLDER));
    expect(result.current.trashView).toBe(true);
    await waitFor(() => expect(result.current.sortedNotes).toEqual([]));
    expect(mocked.notesInFolder).toHaveBeenCalledTimes(1);
  });

  test("test_打つとタグとフォルダの絞りは解ける", () => {
    const given = input();
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.filterByTag("仕事"));
    act(() => result.current.setQuery("予算"));
    expect(result.current.tagFilter).toBeNull();
    expect(result.current.folderFilter).toBeNull();
  });

  test("test_並び順は覚える_既定は更新順", () => {
    const storage = memoryStorage();
    const given = input({ storage });
    const { result } = renderHook(() => useSearch(given));
    expect(result.current.sortOrder).toBe("modified");
    expect(result.current.sortedNotes.map((n) => n.label)).toEqual(["a", "b"]);
    act(() => result.current.changeSort("title"));
    expect(result.current.sortedNotes.map((n) => n.label)).toEqual(["a", "b"]);
    expect(storage.getItem("oboegaki.sort")).toBe("title");
    const again = renderHook(() => useSearch(input({ storage })));
    expect(again.result.current.sortOrder).toBe("title");
  });

  test("test_保存した検索は名前で覚え_同じ名前は上書き_外せる（K-4）", () => {
    const storage = memoryStorage();
    const given = input({ storage });
    const { result } = renderHook(() => useSearch(given));
    act(() => result.current.rememberSearch("今週", "tag:週報"));
    act(() =>
      result.current.rememberSearch("今週", "tag:週報 after:2026-09-01"),
    );
    expect(result.current.searches).toEqual([
      { name: "今週", query: "tag:週報 after:2026-09-01" },
    ]);
    expect(storage.getItem("oboegaki.searches")).toContain("今週");
    act(() => result.current.forgetSearch("今週"));
    expect(result.current.searches).toEqual([]);
  });
});
