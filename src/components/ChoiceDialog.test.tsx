// @vitest-environment jsdom
// 選択肢だけの窓（未保存の復元・外部での削除・競合の 3 択 = spec §7.5）の
// 検証。**外側を押しても閉じない** — 選ばずに済ませられない問いだから。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChoiceDialog } from "./ChoiceDialog";

afterEach(cleanup);

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
});
