// @vitest-environment jsdom
// 書式ツールバー（B-1）の検証。並びと絵は editor/format-toolbar が持つ。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FORMAT_TOOLBAR } from "../editor/format-toolbar";
import { FormatToolbar } from "./FormatToolbar";

afterEach(cleanup);

function setup() {
  const onFormat = vi.fn();
  const onTable = vi.fn();
  const view = render(<FormatToolbar onFormat={onFormat} onTable={onTable} />);
  return { onFormat, onTable, view };
}

describe("FormatToolbar", () => {
  test("test_項目をぜんぶ並べ_群のあいだに区切りを置く", () => {
    const { view } = setup();
    expect(screen.getByRole("toolbar", { name: "書式" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(
      FORMAT_TOOLBAR.flat().length,
    );
    expect(view.container.querySelectorAll(".toolbar-separator")).toHaveLength(
      FORMAT_TOOLBAR.length - 1,
    );
  });

  test("test_押すと書式の種類が渡り_表だけは別の道", () => {
    const { onFormat, onTable } = setup();
    fireEvent.click(screen.getByRole("button", { name: "太字" }));
    expect(onFormat).toHaveBeenCalledWith("strong");
    const table = FORMAT_TOOLBAR.flat().find((item) => item.kind === "table")!;
    fireEvent.click(screen.getByRole("button", { name: table.label }));
    expect(onTable).toHaveBeenCalledTimes(1);
    expect(onFormat).toHaveBeenCalledTimes(1);
  });

  test("test_押しても本文の選択を外さない（mousedown を止める）", () => {
    setup();
    const allowed = fireEvent.mouseDown(
      screen.getByRole("button", { name: "太字" }),
    );
    expect(allowed).toBe(false);
  });

  test("test_文字色のボタンでパレットが開き_色を選ぶと 16 進が渡り_消すは null（ADR-0061）", () => {
    const onColor = vi.fn();
    render(
      <FormatToolbar onFormat={vi.fn()} onTable={vi.fn()} onColor={onColor} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "文字色" }));
    const swatches = screen.getAllByRole("button", { name: /^色: / });
    expect(swatches).toHaveLength(6);
    fireEvent.click(swatches[0]);
    expect(onColor).toHaveBeenCalledWith(
      expect.stringMatching(/^#[0-9a-f]{6}$/),
    );
    fireEvent.click(screen.getByRole("button", { name: "文字色" }));
    fireEvent.click(screen.getByRole("button", { name: "色を消す" }));
    expect(onColor).toHaveBeenCalledWith(null);
  });
});
