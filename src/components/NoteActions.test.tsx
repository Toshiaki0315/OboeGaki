// @vitest-environment jsdom
// ノートの操作ボタン列（ピン → 書き出し → 履歴 → ゴミ箱 → ソース表示）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NoteActions, type NoteActionsProps } from "./NoteActions";

afterEach(cleanup);

function setup(over: Partial<NoteActionsProps> = {}) {
  const props: NoteActionsProps = {
    pinned: false,
    sourceMode: false,
    onPin: vi.fn(),
    onExport: vi.fn(),
    onHistory: vi.fn(),
    onTrash: vi.fn(),
    onToggleSource: vi.fn(),
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
      "ソース表示（Cmd+/）",
    ]);
  });

  test("test_ピンとソース表示は押された状態を見せる", () => {
    setup({ pinned: true, sourceMode: true });
    expect(
      screen
        .getByRole("button", { name: "ピンを外す" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "通常表示に戻す（Cmd+/）" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("test_それぞれのボタンが対応する操作を呼ぶ", () => {
    const props = setup();
    fireEvent.click(screen.getByTitle("HTML に書き出し"));
    fireEvent.click(screen.getByTitle("版の履歴"));
    fireEvent.click(screen.getByTitle("ゴミ箱へ移動"));
    fireEvent.click(screen.getByTitle("ソース表示（Cmd+/）"));
    fireEvent.click(screen.getByTitle("ピン留め（一覧の先頭に固定）"));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onHistory).toHaveBeenCalledTimes(1);
    expect(props.onTrash).toHaveBeenCalledTimes(1);
    expect(props.onToggleSource).toHaveBeenCalledTimes(1);
    expect(props.onPin).toHaveBeenCalledTimes(1);
  });
});
