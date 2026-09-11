// @vitest-environment jsdom
// 版の履歴ダイアログ（ADR-0023）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryDialog } from "./HistoryDialog";

const ENTRIES = [
  { stamp: "2026-09-07 10:00", path: "h/a.md" },
  { stamp: "2026-09-06 09:00", path: "h/b.md" },
];

const TEXTS: Record<string, string> = {
  "h/a.md": "見出し\n二行目\n",
  "h/b.md": "見出し\n古い二行目\n",
};

function setup(entries = ENTRIES, currentText = "見出し\n二行目\n三行目\n") {
  const onRestore = vi.fn();
  const onClose = vi.fn();
  const readVersion = vi.fn(
    async (entry: { path: string }) => TEXTS[entry.path] ?? "",
  );
  render(
    <HistoryDialog
      entries={entries}
      currentText={currentText}
      readVersion={readVersion}
      onRestore={onRestore}
      onClose={onClose}
    />,
  );
  return { onRestore, onClose, readVersion };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  test("test_版を選ぶと今の本文との差分が出る（ADR-0054）", async () => {
    const { readVersion } = setup();
    fireEvent.click(screen.getByText("2026-09-07 10:00"));
    await settle();
    expect(readVersion).toHaveBeenCalledWith(ENTRIES[0]);
    // 版 → 今: 「三行目」が足された
    const added = screen.getByText("三行目");
    expect(added.className).toContain("diff-add");
    expect(screen.getByText("二行目").className).toContain("diff-same");
  });

  test("test_「1 つ前の版と比べる」に切り替えられる", async () => {
    setup();
    fireEvent.click(screen.getByText("2026-09-07 10:00"));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "1 つ前の版と比べる" }));
    await settle();
    // 前の版 → この版: 「古い二行目」が消え「二行目」が足された
    expect(screen.getByText("古い二行目").className).toContain("diff-del");
    expect(screen.getByText("二行目").className).toContain("diff-add");
  });

  test("test_いちばん古い版では「1 つ前」は選べない", async () => {
    setup();
    fireEvent.click(screen.getByText("2026-09-06 09:00"));
    await settle();
    expect(
      (
        screen.getByRole("button", {
          name: "1 つ前の版と比べる",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
