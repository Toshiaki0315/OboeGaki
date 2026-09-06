// @vitest-environment jsdom
// 一覧から 1 つ選ぶパレット（テンプレートを選ぶ / フォルダへ移動）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ListPalette, type ListPaletteProps } from "./ListPalette";

afterEach(cleanup);

const ITEMS = [
  { key: ".", label: "直下", indent: 0 },
  { key: "a", label: "仕事", indent: 1 },
  { key: "a/b", label: "会議", indent: 2 },
];

function setup(over: Partial<ListPaletteProps> = {}) {
  const props: ListPaletteProps = {
    title: "フォルダへ移動",
    items: ITEMS,
    onChoose: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ListPalette {...props} />);
  return props;
}

describe("ListPalette", () => {
  test("test_題と行が並び_先頭が選ばれてフォーカスされている", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "フォルダへ移動" })).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["直下", "仕事", "会議"]);
    expect(buttons[0].className).toBe("selected");
    expect(document.activeElement).toBe(buttons[0]);
  });

  test("test_押した行の番号が渡る", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "会議" }));
    expect(props.onChoose).toHaveBeenCalledWith(2);
  });

  test("test_矢印と Enter でも選べる", () => {
    const props = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // 末尾で止まる
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "仕事" }).className).toBe(
      "selected",
    );
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(props.onChoose).toHaveBeenCalledWith(1);
  });

  test("test_字下げは行ごと", () => {
    setup();
    expect(screen.getByRole("button", { name: "会議" }).style.paddingLeft).toBe(
      "2.1rem",
    );
    expect(screen.getByRole("button", { name: "直下" }).style.paddingLeft).toBe(
      "0.5rem",
    );
  });

  test("test_Escape と外側で閉じる", () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
