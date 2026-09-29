// @vitest-environment jsdom
// 選択肢だけの窓（未保存の復元・外部での削除・競合の 3 択 = spec §7.5）の
// 検証。**外側を押しても閉じない** — 選ばずに済ませられない問いだから。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ChoiceDialog } from "./ChoiceDialog";

describe("ChoiceDialog", () => {
  test("test_題と説明と選択肢が並ぶ", () => {
    render(
      <ChoiceDialog
        title="どうしますか？"
        text="説明の文"
        choices={[
          { label: "外部を採用", onChoose: vi.fn() },
          { label: "自分の版", onChoose: vi.fn() },
          { label: "両方残す", onChoose: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "どうしますか？" })).toBeTruthy();
    expect(screen.getByText("説明の文")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  test("test_押した選択肢だけが呼ばれる", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <ChoiceDialog
        title="問い"
        choices={[
          { label: "いいえ", onChoose: first },
          { label: "はい", onChoose: second },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test("test_説明が無ければ段落を出さない", () => {
    const { container } = render(
      <ChoiceDialog
        title="問い"
        choices={[{ label: "OK", onChoose: vi.fn() }]}
      />,
    );
    expect(container.querySelector(".dialog-text")).toBeNull();
  });

  test("test_開いたときはどのボタンにもフォーカスを当てない_打ちかけの_Enter_で選ばれない（24-1）", () => {
    // 打鍵の最中に勝手に開く窓（外部の変更との競合・起動時の復元）。以前は最初の
    // ボタン（「外部の変更を採用（自分の編集を捨てる）」）にフォーカスが当たり、
    // 変換の Space や Enter で押されて編集が捨てられた
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    const discard = vi.fn();
    render(
      <ChoiceDialog
        title="競合"
        choices={[
          {
            label: "外部の変更を採用（自分の編集を捨てる）",
            onChoose: discard,
          },
          { label: "自分の版で上書き", onChoose: vi.fn() },
        ]}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "競合" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(discard).not.toHaveBeenCalled();
    editor.remove();
  });

  test("test_Tab_で最初の選択肢へ移れる", () => {
    render(
      <ChoiceDialog
        title="問い"
        choices={[
          { label: "いいえ", onChoose: vi.fn() },
          { label: "はい", onChoose: vi.fn() },
        ]}
      />,
    );
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "いいえ" }),
    );
  });
});
