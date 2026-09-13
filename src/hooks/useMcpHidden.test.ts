// @vitest-environment jsdom
// 「Claude に渡さない」の一覧と付け外し（ADR-0049 の続き / 15-14）。
// 読み直しの合図（窓に戻る）と、付け外したあとの一覧の差し替えを見る。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  mcpHidden: vi.fn(),
  setMcpHidden: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { NO_MCP_HIDDEN } from "../lib/mcp-hidden";
import { useMcpHidden } from "./useMcpHidden";

const mocked = vi.mocked(ipc);

beforeEach(() => {
  vi.resetAllMocks();
  mocked.mcpHidden.mockResolvedValue({ listed: ["秘密"], builtin: [".trash"] });
  mocked.setMcpHidden.mockResolvedValue({
    listed: ["秘密", "仕事/評価"],
    builtin: [".trash"],
  });
});
afterEach(() => {
  // 前のテストの hook が残っていると、その focus の聞き手も読みに行って
  // 回数が合わない。毎回はずす
  cleanup();
  vi.restoreAllMocks();
});

describe("useMcpHidden", () => {
  test("test_保管フォルダが決まると一覧を読む", async () => {
    const { result } = renderHook(() => useMcpHidden("/v"));
    await waitFor(() => expect(result.current.hidden.listed).toEqual(["秘密"]));
    expect(mocked.mcpHidden).toHaveBeenCalledWith("/v");
  });

  test("test_保管フォルダが無ければ空", () => {
    const { result } = renderHook(() => useMcpHidden(null));
    expect(result.current.hidden).toEqual(NO_MCP_HIDDEN);
    expect(mocked.mcpHidden).not.toHaveBeenCalled();
  });

  test("test_窓に戻るたびに読み直す（.mcp-ignore は監視が拾わない）", async () => {
    const { result } = renderHook(() => useMcpHidden("/v"));
    await waitFor(() => expect(result.current.hidden.listed).toEqual(["秘密"]));
    await act(async () => {}); // 組み立て直後の読みを全部流してから数える
    // 「戻ったら 1 回増える」を見る（StrictMode の二重マウントで初回の
    // 回数は揺れるので、絶対数ではなく差で見る）
    const before = mocked.mcpHidden.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(mocked.mcpHidden).toHaveBeenCalledTimes(before + 1),
    );
  });

  test("test_付け外すと新しい一覧に差し替わる", async () => {
    const { result } = renderHook(() => useMcpHidden("/v"));
    await waitFor(() => expect(result.current.hidden.listed).toEqual(["秘密"]));
    await act(async () => {
      await result.current.setHidden("仕事/評価", true);
    });
    expect(mocked.setMcpHidden).toHaveBeenCalledWith("/v", "仕事/評価", true);
    expect(result.current.hidden.listed).toEqual(["秘密", "仕事/評価"]);
  });

  test("test_読めなければ空に戻す（落とさない）", async () => {
    mocked.mcpHidden.mockRejectedValue(new Error("だめ"));
    const { result } = renderHook(() => useMcpHidden("/v"));
    await waitFor(() => expect(mocked.mcpHidden).toHaveBeenCalled());
    expect(result.current.hidden).toEqual(NO_MCP_HIDDEN);
  });
});
