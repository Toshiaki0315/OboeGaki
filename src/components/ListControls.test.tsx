// @vitest-environment jsdom
// 一覧の操作行（並び順と「＋ 新規」を横に並べる。要望 2026-09-07）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ListControls, type ListControlsProps } from "./ListControls";

afterEach(cleanup);

function setup(over: Partial<ListControlsProps> = {}) {
  const props: ListControlsProps = {
    sortOrder: "modified",
    onSort: vi.fn(),
    showSort: true,
    newTitle: "「仕事」の中に作る",
    onNew: vi.fn(),
    ...over,
  };
  const view = render(<ListControls {...props} />);
  return { props, view };
}

describe("ListControls", () => {
  test("test_並び順と「＋ 新規」が同じ行に並ぶ", () => {
    const { view } = setup();
    const row = view.container.firstElementChild!;
    expect(row.className).toContain("sort-row");
    expect(row.querySelector("select")).toBeTruthy();
    expect(row.querySelector("button")?.textContent).toBe("＋ 新規");
  });

  test("test_並び順を変えると知らせる", () => {
    const { props } = setup();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "title" },
    });
    expect(props.onSort).toHaveBeenCalledWith("title");
  });

  test("test_「＋ 新規」は置き場所を title で見せ_押すと知らせる", () => {
    const { props } = setup();
    const button = screen.getByRole("button", { name: "＋ 新規" });
    expect(button.getAttribute("title")).toBe("「仕事」の中に作る");
    fireEvent.click(button);
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  test("test_並び順が要らないとき（ゴミ箱・検索中）も「＋ 新規」は残る", () => {
    setup({ showSort: false });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "＋ 新規" })).toBeTruthy();
  });
});
