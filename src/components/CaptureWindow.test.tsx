// @vitest-environment jsdom
// どこからでも書き取り（ADR-0057 / 12-6）の小さな窓。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureWindow } from "./CaptureWindow";

afterEach(cleanup);

function setup() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<CaptureWindow onSubmit={onSubmit} onCancel={onCancel} />);
  const box = screen.getByRole("textbox", {
    name: "書き取り",
  }) as HTMLTextAreaElement;
  return { onSubmit, onCancel, box };
}

describe("CaptureWindow", () => {
  test("test_Cmd+Enter で今日のノートへ送る_空なら送らない", () => {
    const { onSubmit, box } = setup();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "思いつき" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("思いつき");
  });

  test("test_ふつうの Enter は改行のまま_Esc で捨てる", () => {
    const { onSubmit, onCancel, box } = setup();
    fireEvent.change(box, { target: { value: "一行目" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledWith("一行目");
  });

  test("test_案内に送り方が書いてある", () => {
    setup();
    expect(screen.getByText(/⌘\+Enter/)).toBeTruthy();
  });
});
