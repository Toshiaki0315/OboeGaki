// @vitest-environment jsdom
// 環境設定「Qiita」タブ（TASKS 14-1 / ADR-0063）。トークンは Keychain へ入れるだけで、
// 画面には「入っているか」しか出さない。

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { QiitaPreferences, type QiitaTokenAccess } from "./QiitaPreferences";

function access(saved: boolean, overrides: Partial<QiitaTokenAccess> = {}) {
  let current = saved;
  const token: QiitaTokenAccess = {
    saved: vi.fn(async () => current),
    save: vi.fn(async () => {
      current = true;
    }),
    clear: vi.fn(async () => {
      current = false;
    }),
    ...overrides,
  };
  render(<QiitaPreferences token={token} />);
  return token;
}

const field = () =>
  screen.getByLabelText("アクセストークン") as HTMLInputElement;

describe("QiitaPreferences", () => {
  test("test_入っていなければ欄を出し_入れると入っている表示に変わる", async () => {
    const token = access(false);
    await screen.findByText("トークンは入っていません");
    fireEvent.change(field(), { target: { value: "abc123" } });
    fireEvent.click(screen.getByRole("button", { name: "Keychain に入れる" }));
    await screen.findByText("トークンは Keychain に入っています");
    expect(token.save).toHaveBeenCalledWith("abc123");
    // 入れたあとは欄ごと消える（打った値を画面に残さない）
    expect(screen.queryByLabelText("アクセストークン")).toBeNull();
  });

  test("test_欄は伏せ字で_空なら押せない", async () => {
    access(false);
    await screen.findByText("トークンは入っていません");
    expect(field().type).toBe("password");
    expect(
      (
        screen.getByRole("button", {
          name: "Keychain に入れる",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("test_入っていれば値は出さず_消せる", async () => {
    const token = access(true);
    await screen.findByText("トークンは Keychain に入っています");
    expect(screen.queryByLabelText("アクセストークン")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "トークンを消す" }));
    await screen.findByText("トークンは入っていません");
    expect(token.clear).toHaveBeenCalled();
  });

  test("test_入れられなければ理由を出し_欄は残す", async () => {
    access(false, {
      save: vi.fn(async () => {
        throw "トークンの形ではありません";
      }),
    });
    await screen.findByText("トークンは入っていません");
    fireEvent.change(field(), { target: { value: "x y" } });
    fireEvent.click(screen.getByRole("button", { name: "Keychain に入れる" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "トークンの形ではありません",
    );
    await waitFor(() => expect(field().value).toBe("x y"));
  });
});
