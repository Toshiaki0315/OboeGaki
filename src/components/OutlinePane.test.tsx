// @vitest-environment jsdom
// アウトライン（Cmd+5、出しっぱなしの目次）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { OutlinePane, type OutlinePaneProps } from "./OutlinePane";

afterEach(cleanup);

const ITEMS = [
  { level: 1, text: "題", from: 0 },
  { level: 2, text: "節", from: 10 },
  { level: 3, text: "項", from: 20 },
];

function setup(over: Partial<OutlinePaneProps> = {}) {
  const props: OutlinePaneProps = {
    items: ITEMS,
    currentIndex: 1,
    onJump: vi.fn(),
    onMenu: vi.fn(),
    ...over,
  };
  render(<OutlinePane {...props} />);
  return props;
}

describe("OutlinePane", () => {
  test("test_見出しを深さで字下げして並べ_現在地に印", () => {
    setup();
    expect(screen.getByRole("button", { name: "項" }).style.paddingLeft).toBe(
      "2.3rem",
    );
    expect(screen.getByRole("button", { name: "節" }).className).toBe(
      "current",
    );
    expect(screen.getByRole("button", { name: "題" }).className).toBe("");
  });

  test("test_押すとその位置へ", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "項" }));
    expect(props.onJump).toHaveBeenCalledWith(20);
  });

  test("test_右クリックで節の位置と場所を知らせる（7-1）", () => {
    const props = setup();
    fireEvent.contextMenu(screen.getByRole("button", { name: "節" }), {
      clientX: 5,
      clientY: 6,
    });
    expect(props.onMenu).toHaveBeenCalledWith({ from: 10, x: 5, y: 6 });
  });

  test("test_見出しが無ければ案内", () => {
    setup({ items: [], currentIndex: -1 });
    expect(screen.getByText("見出しがありません")).toBeTruthy();
  });
});
