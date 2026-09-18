// @vitest-environment jsdom
// ダイアログの殻（19-3 / 20-1）。閉じ方（Esc・背景）と focus の面倒
// （中で Tab を回す・開いたら中へ・閉じたら元へ）を 1 か所で見る。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Dialog } from "./Dialog";

function twoButtons() {
  return (
    <>
      <button>いち</button>
      <button>に</button>
    </>
  );
}

describe("Dialog", () => {
  test("test_Esc で onClose が呼ばれる", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="問い" onClose={onClose}>
        {twoButtons()}
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("test_中の部品で押した Esc も 1 回だけ閉じる", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="問い" onClose={onClose}>
        <input aria-label="欄" />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText("欄"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("test_onClose が無ければ Esc では閉じない", () => {
    const onKeyDown = vi.fn();
    render(
      <Dialog title="選ばずに済ませられない問い" onKeyDown={onKeyDown}>
        {twoButtons()}
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    // 呼び手の onKeyDown は変わらず届く
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  test("test_変換中の Esc は IME の取り消しなので閉じない", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="問い" onClose={onClose}>
        <input aria-label="欄" />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText("欄"), {
      key: "Escape",
      isComposing: true,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("test_呼び手の onKeyDown が先に止めた Esc では閉じない", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        title="問い"
        onClose={onClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}
      >
        {twoButtons()}
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("test_開いたら中の最初の部品に focus が移る", () => {
    render(<Dialog title="問い">{twoButtons()}</Dialog>);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "いち" }),
    );
  });

  test("test_中に autoFocus があれば奪わない", () => {
    render(
      <Dialog title="問い">
        <button>いち</button>
        <input aria-label="欄" autoFocus />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("欄"));
  });

  test("test_Tab は中で回る", () => {
    render(<Dialog title="問い">{twoButtons()}</Dialog>);
    const first = screen.getByRole("button", { name: "いち" });
    const last = screen.getByRole("button", { name: "に" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("test_端でない Tab はブラウザに任せる", () => {
    render(<Dialog title="問い">{twoButtons()}</Dialog>);
    const first = screen.getByRole("button", { name: "いち" });
    first.focus();
    const handled = fireEvent.keyDown(first, { key: "Tab" });
    // preventDefault していない（= 既定の移動に任せた）
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  test("test_閉じたら開く前に focus があった所へ戻る", () => {
    const before = document.createElement("button");
    before.textContent = "編集面";
    document.body.appendChild(before);
    before.focus();
    const { unmount } = render(<Dialog title="問い">{twoButtons()}</Dialog>);
    expect(document.activeElement).not.toBe(before);
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  test("test_閉じるときに呼び手が別の所へ focus を移していたら上書きしない", () => {
    const before = document.createElement("button");
    const elsewhere = document.createElement("button");
    document.body.append(before, elsewhere);
    before.focus();
    const { unmount } = render(<Dialog title="問い">{twoButtons()}</Dialog>);
    elsewhere.focus();
    unmount();
    expect(document.activeElement).toBe(elsewhere);
    before.remove();
    elsewhere.remove();
  });
});
