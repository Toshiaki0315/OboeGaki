// @vitest-environment jsdom
// ゴミ箱の中身の一覧（要望 2026-09-05）の検証。出せる操作は右クリックに絞る。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TrashRows, type TrashRowsProps } from "./TrashRows";

afterEach(cleanup);

const ROOT = "/v";

function setup(over: Partial<TrashRowsProps> = {}) {
  const props: TrashRowsProps = {
    vaultRoot: ROOT,
    entries: [
      { path: `${ROOT}/.trash/仕事/会議.md`, trashedMs: 0 },
      { path: `${ROOT}/.trash/メモ.md`, trashedMs: 0 },
    ],
    currentPath: null,
    trashDays: 30,
    onOpen: vi.fn(),
    onMenu: vi.fn(),
    ...over,
  };
  const view = render(<TrashRows {...props} />);
  return { props, view };
}

describe("TrashRows", () => {
  test("test_名前と元の場所を出す_直下のものには場所を出さない", () => {
    const { view } = setup();
    expect(screen.getByText("会議")).toBeTruthy();
    expect(screen.getByText("メモ")).toBeTruthy();
    expect(view.container.querySelectorAll(".trash-folder")).toHaveLength(1);
  });

  test("test_押すと開き_右クリックで親に知らせる", () => {
    const { props } = setup();
    fireEvent.click(screen.getByText("メモ"));
    expect(props.onOpen).toHaveBeenCalledWith(`${ROOT}/.trash/メモ.md`);
    fireEvent.contextMenu(screen.getByText("会議"), { clientX: 1, clientY: 2 });
    expect(props.onMenu).toHaveBeenCalledWith({
      path: `${ROOT}/.trash/仕事/会議.md`,
      x: 1,
      y: 2,
    });
  });

  test("test_空なら保持日数を添えて案内", () => {
    setup({ entries: [], trashDays: 14 });
    expect(
      screen.getByText(/ゴミ箱は空です。捨てたノートは 14 日残ります/),
    ).toBeTruthy();
  });

  test("test_開いているものに印", () => {
    const { view } = setup({ currentPath: `${ROOT}/.trash/メモ.md` });
    expect(view.container.querySelectorAll(".trash-row.selected")).toHaveLength(
      1,
    );
  });
});
