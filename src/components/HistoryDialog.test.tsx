// @vitest-environment jsdom
// 版の履歴ダイアログ（ADR-0023）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryDialog } from "./HistoryDialog";

const ENTRIES = [
  { stamp: "2026-09-07 10:00", path: "h/a.md" },
  { stamp: "2026-09-06 09:00", path: "h/b.md" },
];

function setup(entries = ENTRIES) {
  const onRestore = vi.fn();
  const onClose = vi.fn();
  render(
    <HistoryDialog entries={entries} onRestore={onRestore} onClose={onClose} />,
  );
  return { onRestore, onClose };
}

afterEach(cleanup);

describe("HistoryDialog", () => {
  test("test_版ごとに日時と「戻す」が並ぶ", () => {
    setup();
    expect(screen.getByText("2026-09-07 10:00")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "戻す" })).toHaveLength(2);
  });

  test("test_版が無ければ案内を出す", () => {
    setup([]);
    expect(screen.getByText(/まだ版がありません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "戻す" })).toBeNull();
  });

  test("test_「戻す」でその版が渡る", () => {
    const { onRestore } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "戻す" })[1]);
    expect(onRestore).toHaveBeenCalledWith(ENTRIES[1]);
  });

  test("test_外側を押すと閉じ_中を押しても閉じない", () => {
    const { onClose } = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
