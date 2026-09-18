// @vitest-environment jsdom
// ノートの操作ボタン列（ピン → 書き出し → 履歴 → ゴミ箱 → 編集モード）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NoteActions, type NoteActionsProps } from "./NoteActions";

function setup(over: Partial<NoteActionsProps> = {}) {
  const props: NoteActionsProps = {
    pinned: false,
    editMode: "inline",
    onPin: vi.fn(),
    onExport: vi.fn(),
    onHistory: vi.fn(),
    onTrash: vi.fn(),
    onCycleMode: vi.fn(),
    ...over,
  };
  render(<NoteActions {...props} />);
  return props;
}

describe("NoteActions", () => {
  test("test_5 つのボタンが決まった順で並ぶ", () => {
    setup();
    const titles = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("title"));
    expect(titles).toEqual([
      "ピン留め（一覧の先頭に固定）",
      "HTML に書き出し",
      "版の履歴",
      "ゴミ箱へ移動",
      "編集モード: インラインモード（押すとソースモードへ）",
    ]);
  });

  test("test_ピンは押された状態を見せる", () => {
    setup({ pinned: true });
    expect(
      screen
        .getByRole("button", { name: "ピンを外す" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("test_編集モードのボタンは今のモードを絵と説明で見せ_次のモードを予告する", () => {
    // 3 つを 1 つのボタンで巡るので、「今どこか」が見えないと押せない
    setup({ editMode: "source" });
    const button = screen.getByTitle(
      "編集モード: ソースモード（押すとプレビューモードへ）",
    );
    expect(button.getAttribute("data-mode")).toBe("source");
    cleanup();
    setup({ editMode: "preview" });
    expect(
      screen
        .getByTitle("編集モード: プレビューモード（押すとインラインモードへ）")
        .getAttribute("data-mode"),
    ).toBe("preview");
  });

  test("test_モードごとに違う絵が出る", () => {
    const iconOf = (mode: NoteActionsProps["editMode"]) => {
      cleanup();
      setup({ editMode: mode });
      return screen
        .getByRole("button", { name: /^編集モード/ })
        .querySelector("svg")!.innerHTML;
    };
    const icons = new Set(
      ["inline", "source", "preview"].map((m) =>
        iconOf(m as NoteActionsProps["editMode"]),
      ),
    );
    expect(icons.size).toBe(3);
  });

  test("test_それぞれのボタンが対応する操作を呼ぶ", () => {
    const props = setup();
    fireEvent.click(screen.getByTitle("HTML に書き出し"));
    fireEvent.click(screen.getByTitle("版の履歴"));
    fireEvent.click(screen.getByTitle("ゴミ箱へ移動"));
    fireEvent.click(screen.getByTitle(/^編集モード/));
    fireEvent.click(screen.getByTitle("ピン留め（一覧の先頭に固定）"));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onHistory).toHaveBeenCalledTimes(1);
    expect(props.onTrash).toHaveBeenCalledTimes(1);
    expect(props.onCycleMode).toHaveBeenCalledTimes(1);
    expect(props.onPin).toHaveBeenCalledTimes(1);
  });
});
