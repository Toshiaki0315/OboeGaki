// @vitest-environment jsdom
// やること一覧（ADR-0056 / 12-5）。全ノートの未完了を 1 つの節に集める。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TaskSection, type TaskSectionProps } from "./TaskSection";

afterEach(cleanup);

const TASKS = [
  {
    path: "仕事/b.md",
    line: 0,
    text: "近い @2026-10-01",
    due: "2026-10-01",
    mtime_ms: 1,
  },
  { path: "a.md", line: 3, text: "期限なし", due: null, mtime_ms: 2 },
];

function setup(over: Partial<TaskSectionProps> = {}) {
  const props: TaskSectionProps = {
    tasks: TASKS,
    open: true,
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onComplete: vi.fn(),
    ...over,
  };
  render(<TaskSection {...props} />);
  return props;
}

describe("TaskSection", () => {
  test("test_文と_ノートの名前と_期限を並べ_見出しに件数", () => {
    setup();
    expect(screen.getByText("近い @2026-10-01")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy(); // ノートの名前（幹）
    expect(screen.getByText("10/01")).toBeTruthy(); // 期限は短く
    expect(screen.getByText("2")).toBeTruthy(); // 件数
  });

  test("test_文を押すとそのノートの行へ_箱を押すと完了", () => {
    const props = setup();
    fireEvent.click(screen.getByText("期限なし"));
    expect(props.onOpen).toHaveBeenCalledWith("a.md", 3);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "近い @2026-10-01 を完了にする" }),
    );
    expect(props.onComplete).toHaveBeenCalledWith("仕事/b.md", 0);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  test("test_無ければ案内", () => {
    setup({ tasks: [] });
    expect(screen.getByText("未完了のやることはありません")).toBeTruthy();
  });
});
