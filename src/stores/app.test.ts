// アプリ状態（Zustand）。開く → 一覧を引く、の順と、失敗したときの姿。
// Rust への包み（lib/ipc）は差し替える。

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  fetchLists: vi.fn(),
  openVaultRoot: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { useAppStore } from "./app";

const mocked = vi.mocked(ipc);
const LISTS = {
  notes: [],
  tags: [{ tag: "仕事", count: 1 }],
  folders: [],
  trashNotes: [],
  tasks: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({
    vaultRoot: null,
    notes: [],
    tags: [],
    folders: [],
    trashNotes: [],
    tasks: [],
    currentPath: "/old/x.md",
  });
  mocked.openVaultRoot.mockResolvedValue(undefined);
  mocked.fetchLists.mockResolvedValue(LISTS);
});

describe("useAppStore.openVault", () => {
  test("test_開いてから一覧を引き_選択は外す", async () => {
    await useAppStore.getState().openVault("/v", 30);
    expect(mocked.openVaultRoot).toHaveBeenCalledWith("/v", 30);
    expect(mocked.fetchLists).toHaveBeenCalledWith("/v");
    // 開く → 一覧、の順（レイアウトと監視ができてから引く）
    expect(mocked.openVaultRoot.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.fetchLists.mock.invocationCallOrder[0],
    );
    const state = useAppStore.getState();
    expect(state.vaultRoot).toBe("/v");
    expect(state.tags).toEqual(LISTS.tags);
    expect(state.currentPath).toBeNull();
  });

  test("test_開けなければ一覧は引かず_状態も変えない", async () => {
    mocked.openVaultRoot.mockRejectedValue(new Error("lock"));
    await expect(useAppStore.getState().openVault("/v")).rejects.toThrow(
      "lock",
    );
    expect(mocked.fetchLists).not.toHaveBeenCalled();
    expect(useAppStore.getState().vaultRoot).toBeNull();
  });
});

describe("useAppStore.refresh / selectNote", () => {
  test("test_保管フォルダが無ければ引かない", async () => {
    await useAppStore.getState().refresh();
    expect(mocked.fetchLists).not.toHaveBeenCalled();
  });

  test("test_あれば引き直して差し替える", async () => {
    useAppStore.setState({ vaultRoot: "/v" });
    await useAppStore.getState().refresh();
    expect(mocked.fetchLists).toHaveBeenCalledWith("/v");
    expect(useAppStore.getState().tags).toEqual(LISTS.tags);
  });

  test("test_selectNote_は選択だけを変える", () => {
    useAppStore.getState().selectNote("/v/a.md");
    expect(useAppStore.getState().currentPath).toBe("/v/a.md");
    useAppStore.getState().selectNote(null);
    expect(useAppStore.getState().currentPath).toBeNull();
  });
});
