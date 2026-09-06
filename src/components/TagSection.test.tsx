// @vitest-environment jsdom
// サイドバーのタグ一覧（C-4）の検証。開閉はフォルダと排他なので親が持つ。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TagSection, type TagSectionProps } from "./TagSection";

afterEach(cleanup);

function setup(over: Partial<TagSectionProps> = {}) {
  const props: TagSectionProps = {
    tags: [
      { tag: "仕事", count: 3 },
      { tag: "日記", count: 1 },
    ],
    tagFilter: null,
    open: true,
    onToggle: vi.fn(),
    onFilter: vi.fn(),
    onMenu: vi.fn(),
    ...over,
  };
  render(<TagSection {...props} />);
  return props;
}

describe("TagSection", () => {
  test("test_タグと件数を並べ_見出しに総数", () => {
    setup();
    expect(screen.getByText("#仕事")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // タグの数
  });

  test("test_押すと絞り_もう一度押すと解除", () => {
    const props = setup();
    fireEvent.click(screen.getByText("#仕事"));
    expect(props.onFilter).toHaveBeenCalledWith("仕事");
    cleanup();
    const again = setup({ tagFilter: "仕事" });
    expect(screen.getByText("#仕事").closest("button")?.className).toContain(
      "selected",
    );
    fireEvent.click(screen.getByText("#仕事"));
    expect(again.onFilter).toHaveBeenCalledWith(null);
  });

  test("test_右クリックは OS のメニューを出さず親に知らせる", () => {
    const props = setup();
    const allowed = fireEvent.contextMenu(screen.getByText("#日記"), {
      clientX: 3,
      clientY: 4,
    });
    expect(allowed).toBe(false);
    expect(props.onMenu).toHaveBeenCalledWith({ tag: "日記", x: 3, y: 4 });
  });

  test("test_見出しを押すと開閉を親に任せる", () => {
    const props = setup();
    const allowed = fireEvent.click(screen.getByText("タグ"));
    expect(allowed).toBe(false); // details の既定の開閉は使わない
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});
