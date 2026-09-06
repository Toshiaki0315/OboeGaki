// @vitest-environment jsdom
// 表の挿入（TASKS 2-6）— 行 × 列を聞く窓の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TableDialog } from "./TableDialog";

afterEach(cleanup);

function setup() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<TableDialog onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose };
}

describe("TableDialog", () => {
  test("test_既定は 2 行 2 列", () => {
    const { onInsert } = setup();
    fireEvent.click(screen.getByRole("button", { name: "挿入" }));
    expect(onInsert).toHaveBeenCalledWith(2, 2);
  });

  test("test_打った行と列で挿入する", () => {
    const { onInsert } = setup();
    fireEvent.change(screen.getByLabelText("行（見出しを除く）"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("列"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "挿入" }));
    expect(onInsert).toHaveBeenCalledWith(5, 3);
  });

  test("test_読めない値は 2 に落とす", () => {
    const { onInsert } = setup();
    fireEvent.change(screen.getByLabelText("列"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "挿入" }));
    expect(onInsert).toHaveBeenCalledWith(2, 2);
  });

  test("test_やめると外側で閉じる", () => {
    const { onClose, onInsert } = setup();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onInsert).not.toHaveBeenCalled();
  });
});
