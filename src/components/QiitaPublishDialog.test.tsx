// @vitest-environment jsdom
// Qiita への投稿の小窓（TASKS 14-5 / ADR-0063 の決定）。タグを確かめ、載らない画像を
// 先に言い、限定共有で出ることを言ってから送る。

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { QiitaDraft } from "../lib/qiita";
import { QiitaPublishDialog } from "./QiitaPublishDialog";

const DRAFT: QiitaDraft = {
  title: "設計メモ",
  body: "本文\n",
  tags: ["Rust", "Tauri"],
  localImages: [],
};

function setup(
  over: Partial<QiitaDraft> = {},
  { update = false, onPublish = vi.fn(async () => {}) } = {},
) {
  const onClose = vi.fn();
  render(
    <QiitaPublishDialog
      draft={{ ...DRAFT, ...over }}
      update={update}
      onPublish={onPublish}
      onClose={onClose}
    />,
  );
  return { onPublish, onClose };
}

const publishButton = () =>
  screen.getByRole("button", {
    name: /投稿する|更新する/,
  }) as HTMLButtonElement;

describe("QiitaPublishDialog", () => {
  test("test_題と本文の_#タグ_を出し_そのまま送れる", async () => {
    const { onPublish } = setup();
    expect(screen.getByText("設計メモ")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rust を外す" })).toBeTruthy();
    fireEvent.click(publishButton());
    await waitFor(() =>
      expect(onPublish).toHaveBeenCalledWith(["Rust", "Tauri"]),
    );
  });

  test("test_新規は限定共有で出ることを言う", () => {
    setup();
    expect(screen.getByText(/限定共有で出します/)).toBeTruthy();
    expect(publishButton().textContent).toBe("限定共有で投稿する");
  });

  test("test_更新のときは公開の状態を変えないと言う", () => {
    setup({}, { update: true });
    expect(screen.getByText(/公開の状態は変えません/)).toBeTruthy();
    expect(publishButton().textContent).toBe("更新する");
  });

  test("test_タグを外し_足せる_同じタグは足さない", async () => {
    const { onPublish } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Tauri を外す" }));
    const field = screen.getByLabelText("タグを足す");
    fireEvent.change(field, { target: { value: "#React" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "rust" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(publishButton());
    await waitFor(() =>
      expect(onPublish).toHaveBeenCalledWith(["Rust", "React"]),
    );
  });

  test("test_タグが_0_個や_6_個以上なら押せない", () => {
    setup({ tags: [] });
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText(/タグは 1〜5 個/)).toBeTruthy();
  });

  test("test_6_個目は足せない", () => {
    setup({ tags: ["a", "b", "c", "d", "e"] });
    const field = screen.getByLabelText("タグを足す") as HTMLInputElement;
    expect(field.disabled).toBe(true);
  });

  test("test_載らない画像があれば先に言う", () => {
    setup({ localImages: ["attachments/a.png", "attachments/b.png"] });
    const warning = screen.getByRole("note");
    expect(warning.textContent).toContain("2 枚の画像は Qiita に載りません");
    expect(warning.textContent).toContain("attachments/a.png");
  });

  test("test_送れなければ理由を出し_窓は残す", async () => {
    const { onClose } = setup(
      {},
      {
        onPublish: vi.fn(async () => {
          throw "トークンが違うか、期限が切れています";
        }),
      },
    );
    fireEvent.click(publishButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "トークンが違うか",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(publishButton().disabled).toBe(false);
  });

  test("test_送っている間は二度押せない", async () => {
    let finish: () => void = () => {};
    const onPublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setup({}, { onPublish });
    fireEvent.click(publishButton());
    await screen.findByText("送っています…");
    fireEvent.click(screen.getByText("送っています…"));
    expect(onPublish).toHaveBeenCalledTimes(1);
    finish();
  });
});
