// @vitest-environment jsdom
// 名前や日付を 1 つ聞く窓（フォルダ名・検索の保存・テンプレート登録・
// 日付を選ぶ）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PromptDialog, type PromptDialogProps } from "./PromptDialog";

afterEach(cleanup);

function setup(over: Partial<PromptDialogProps> = {}) {
  const props: PromptDialogProps = {
    title: "新しいフォルダ",
    label: "名前",
    confirmLabel: "決定",
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<PromptDialog {...props} />);
  return props;
}

describe("PromptDialog", () => {
  test("test_題と欄と既定値が出る", () => {
    setup({ defaultValue: "下書き", note: "説明の文" });
    expect(screen.getByRole("dialog", { name: "新しいフォルダ" })).toBeTruthy();
    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe(
      "下書き",
    );
    expect(screen.getByText("説明の文")).toBeTruthy();
  });

  test("test_Enter で打った名前を前後の空白を落として渡す", () => {
    const props = setup();
    const input = screen.getByLabelText("名前");
    fireEvent.change(input, { target: { value: "  メモ  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onConfirm).toHaveBeenCalledWith("メモ");
  });

  test("test_空のままでは決定できない（窓は開いたまま）", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  test("test_決定ボタンでも渡る", () => {
    const props = setup({ defaultValue: "既定" });
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(props.onConfirm).toHaveBeenCalledWith("既定");
  });

  test("test_T5_変換中の Enter は確定であって決定ではない（実機報告 2026-09-08）", () => {
    // 日本語を打って未確定のまま Enter → 確定だけ。次の Enter で決定
    const props = setup();
    const input = screen.getByLabelText("名前");
    fireEvent.change(input, { target: { value: "かいぎ" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 }); // WebKit
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" }); // WebKit: 確定の直後
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  test("test_Escape と「やめる」と外側で閉じる", () => {
    const props = setup();
    fireEvent.keyDown(screen.getByLabelText("名前"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(3);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  test("test_日付の欄にもなる", () => {
    setup({ type: "date", label: "日付", defaultValue: "2026-09-07" });
    const input = screen.getByLabelText("日付") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-09-07");
  });
});
