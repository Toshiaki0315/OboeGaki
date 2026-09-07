// @vitest-environment jsdom
// あいまい検索のパレット（クイックオープン Cmd+P / 見出しへ飛ぶ Cmd+R）の
// 検証。絞り方は lib/fuzzy に任せ、ここでは打鍵・矢印・Enter の取り回しを見る。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FuzzyPalette, type FuzzyPaletteProps } from "./FuzzyPalette";

afterEach(cleanup);

const LABELS = ["りんご", "ばなな", "みかん"];

function setup(over: Partial<FuzzyPaletteProps> = {}) {
  const props: FuzzyPaletteProps = {
    placeholder: "ノート名で開く",
    labels: LABELS,
    limit: 20,
    onChoose: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<FuzzyPalette {...props} />);
  return props;
}

describe("FuzzyPalette", () => {
  test("test_開いた直後は全部並び_先頭が選ばれている", () => {
    setup();
    expect(screen.getByPlaceholderText("ノート名で開く")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(LABELS);
    expect(buttons[0].className).toBe("selected");
  });

  test("test_打つと絞られ_選択は先頭へ戻る", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "みかん" },
    });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["みかん"]);
    expect(buttons[0].className).toBe("selected");
  });

  test("test_矢印で動かして Enter で選ぶと元の並びの番号が渡る", () => {
    const props = setup();
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 末尾で止まる
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onChoose).toHaveBeenCalledWith(1);
  });

  test("test_絞ったあとの Enter も元の並びの番号", () => {
    const props = setup();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "みかん" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onChoose).toHaveBeenCalledWith(2);
  });

  test("test_押しても選べる_載せた上でも選択が動く", () => {
    const props = setup();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "ばなな" }));
    expect(screen.getByRole("button", { name: "ばなな" }).className).toBe(
      "selected",
    );
    fireEvent.click(screen.getByRole("button", { name: "みかん" }));
    expect(props.onChoose).toHaveBeenCalledWith(2);
  });

  test("test_見つからなければ案内_Enter で何も起きない", () => {
    const props = setup();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "ぶどう" },
    });
    expect(screen.getByText("見つかりません")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  test("test_T5_変換中の Enter では選ばない（日本語のノート名を打つ途中）", () => {
    const props = setup();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "みかん" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 }); // WebKit
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" }); // WebKit: 確定の直後
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  test("test_Escape と外側で閉じる", () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  test("test_上限までしか出さない", () => {
    setup({ limit: 2 });
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  test("test_字下げは行ごとに指定できる（見出しの階層）", () => {
    setup({ indentOf: (index) => index * 0.9 });
    expect(
      screen.getByRole("button", { name: "みかん" }).style.paddingLeft,
    ).toBe("2.3rem");
  });
});
