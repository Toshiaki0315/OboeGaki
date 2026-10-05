// @vitest-environment jsdom
// 施錠のパスワードの窓（TASKS 13-5 / ADR-0062）。最初に決める・入れる・変えるの 3 つ。

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LockPasswordDialog } from "./LockPasswordDialog";

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () =>
  screen.getByRole("button", { name: /施錠する|変える/ }) as HTMLButtonElement;

describe("LockPasswordDialog: 最初に決める（決定 3: 忘れたら読めない）", () => {
  test("test_2_回同じものを打ち_忘れたら読めないと確かめてから施錠する", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <LockPasswordDialog
        mode="create"
        title="秘密"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/忘れると、施錠したノートは読めなくなります/),
    ).toBeTruthy();
    type("パスワード", "合言葉");
    type("もう一度", "合言葉");
    expect(submit().disabled).toBe(true); // 確かめるまで押せない
    fireEvent.click(
      screen.getByLabelText(/忘れたら読めないことを分かりました/),
    );
    fireEvent.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("合言葉", ""));
  });

  test("test_2_回が違えば押せず_そう言う", () => {
    render(
      <LockPasswordDialog
        mode="create"
        title="秘密"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    type("パスワード", "合言葉");
    type("もう一度", "合言");
    fireEvent.click(
      screen.getByLabelText(/忘れたら読めないことを分かりました/),
    );
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("2 回目が違います")).toBeTruthy();
  });
});

describe("LockPasswordDialog: 入れる", () => {
  test("test_施錠ノートがあれば_今のパスワードを 1 回だけ聞く", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <LockPasswordDialog
        mode="enter"
        title="秘密"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("もう一度")).toBeNull();
    type("パスワード", "合言葉");
    fireEvent.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("合言葉", ""));
  });

  test("test_違えば理由を出して欄を空にする", async () => {
    render(
      <LockPasswordDialog
        mode="enter"
        title="秘密"
        onSubmit={vi.fn(async () => {
          throw "パスワードが違います";
        })}
        onClose={vi.fn()}
      />,
    );
    type("パスワード", "ちがう");
    fireEvent.click(submit());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "パスワードが違います",
    );
    expect(
      (screen.getByLabelText("パスワード") as HTMLInputElement).value,
    ).toBe("");
  });
});

describe("LockPasswordDialog: 変える", () => {
  test("test_今のパスワードと新しいパスワードを_2_回聞く", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <LockPasswordDialog
        mode="change"
        title=""
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    type("今のパスワード", "古い");
    type("新しいパスワード", "新しい");
    type("もう一度", "新しい");
    fireEvent.click(
      screen.getByLabelText(/忘れたら読めないことを分かりました/),
    );
    fireEvent.click(submit());
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("新しい", "古い"),
    );
  });
});
