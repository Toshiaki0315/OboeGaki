// @vitest-environment jsdom
// 環境設定「MCP」タブ。**押したことが分かる**（クリップボードは目に見えない）。

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { McpPreferences } from "./McpPreferences";

describe("McpPreferences", () => {
  test("test_押すとコピーしたと出る", async () => {
    render(<McpPreferences onCopyMcpConfig={() => Promise.resolve(true)} />);
    expect(screen.queryByText("コピーしました")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "設定をコピー" }));
    });
    expect(screen.getByText("コピーしました")).toBeTruthy();
  });

  test("test_コピーできなければそう出る（黙って成功に見せない）", async () => {
    render(<McpPreferences onCopyMcpConfig={() => Promise.resolve(false)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "設定をコピー" }));
    });
    expect(screen.getByText("コピーできませんでした")).toBeTruthy();
  });

  test("test_知らせはしばらくすると消える", async () => {
    vi.useFakeTimers();
    try {
      render(<McpPreferences onCopyMcpConfig={() => Promise.resolve(true)} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "設定をコピー" }));
      });
      expect(screen.getByText("コピーしました")).toBeTruthy();
      act(() => void vi.advanceTimersByTime(4000));
      expect(screen.queryByText("コピーしました")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
