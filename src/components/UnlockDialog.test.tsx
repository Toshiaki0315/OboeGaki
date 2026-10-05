// @vitest-environment jsdom
// 施錠ノートを開く前にパスワードを聞く窓（TASKS 13-3 / ADR-0062）。

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UnlockDialog } from "./UnlockDialog";

function setup(onUnlock = vi.fn(async () => {})) {
  const onClose = vi.fn();
  render(<UnlockDialog title="秘密" onUnlock={onUnlock} onClose={onClose} />);
  return { onUnlock, onClose };
}

const field = () => screen.getByLabelText("パスワード") as HTMLInputElement;

describe("UnlockDialog", () => {
  test("test_伏せ字の欄にパスワードを入れて解錠を頼む", async () => {
    const { onUnlock } = setup();
    expect(screen.getByText(/「秘密」は施錠されています/)).toBeTruthy();
    expect(field().type).toBe("password");
    fireEvent.change(field(), { target: { value: "合言葉" } });
    fireEvent.click(screen.getByRole("button", { name: "解錠" }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("合言葉"));
  });

  test("test_Enter_でも解錠するが_変換の確定では送らない", async () => {
    const { onUnlock } = setup();
    fireEvent.change(field(), { target: { value: "合言葉" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onUnlock).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("合言葉"));
  });

  test("test_違えば理由を出し_欄を空にしてやり直せる", async () => {
    setup(
      vi.fn(async () => {
        throw "パスワードが違います";
      }),
    );
    fireEvent.change(field(), { target: { value: "ちがう" } });
    fireEvent.click(screen.getByRole("button", { name: "解錠" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "パスワードが違います",
    );
    expect(field().value).toBe("");
  });

  test("test_空なら押せない", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "解錠" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
