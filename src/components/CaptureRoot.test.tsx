// @vitest-environment jsdom
// 書き取りの窓の土台（ADR-0057）。保管フォルダは主窓と同じ localStorage から。
// 送ったら閉じる、失敗したら赤字、Esc は書いていれば確かめる。

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  appendDaily: vi.fn(),
  closeCurrentWindow: vi.fn(),
  confirmDialog: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { VAULT_KEY } from "../lib/last-vault";
import { CaptureRoot } from "./CaptureRoot";

const mocked = vi.mocked(ipc);
const confirmed = mocked.confirmDialog;
const close = mocked.closeCurrentWindow;
const box = () => screen.getByRole("textbox", { name: "書き取り" });

// vitest の jsdom は localStorage を持たないことがある。主窓と同じ置き場
// （VAULT_KEY）を Map で代える
const storage = new Map<string, string>();
beforeEach(() => {
  vi.resetAllMocks();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  mocked.appendDaily.mockResolvedValue("/v/2026-09-17.md");
  close.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CaptureRoot", () => {
  test("test_保管フォルダが無ければ案内だけ", () => {
    render(<CaptureRoot />);
    expect(screen.getByText(/保管フォルダがまだ開かれていません/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("test_送っている間に_2_回押しても_1_回しか足さない（21-3）", async () => {
    storage.set(VAULT_KEY, "/v");
    let finish: (path: string) => void = () => {};
    mocked.appendDaily.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    render(<CaptureRoot />);
    fireEvent.change(box(), { target: { value: "思いつき" } });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(mocked.appendDaily).toHaveBeenCalledTimes(1);
    expect(box()).toHaveProperty("readOnly", true);
    finish("/v/2026-09-24.md");
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  test("test_足せたのに閉じられないときは再送を受けない（21-5）", async () => {
    storage.set(VAULT_KEY, "/v");
    close.mockRejectedValue(new Error("window"));
    render(<CaptureRoot />);
    fireEvent.change(box(), { target: { value: "思いつき" } });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(screen.getByText(/閉じられませんでした/)).toBeTruthy(),
    );
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(mocked.appendDaily).toHaveBeenCalledTimes(1);
  });

  test("test_送ると今日のノートへ足して閉じる", async () => {
    storage.set(VAULT_KEY, "/v");
    render(<CaptureRoot />);
    fireEvent.change(box(), { target: { value: "思いつき" } });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(mocked.appendDaily).toHaveBeenCalledWith("/v", "思いつき"),
    );
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  test("test_書けなければ赤字で知らせ_閉じない", async () => {
    storage.set(VAULT_KEY, "/v");
    mocked.appendDaily.mockRejectedValue(new Error("disk"));
    render(<CaptureRoot />);
    fireEvent.change(box(), { target: { value: "思いつき" } });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(await screen.findByText(/書けませんでした: .*disk/)).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  test("test_Esc_は空なら黙って閉じ_書いていれば確かめてから", async () => {
    storage.set(VAULT_KEY, "/v");
    render(<CaptureRoot />);
    fireEvent.keyDown(box(), { key: "Escape" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(confirmed).not.toHaveBeenCalled();

    fireEvent.change(box(), { target: { value: "途中" } });
    confirmed.mockResolvedValue(false);
    fireEvent.keyDown(box(), { key: "Escape" });
    await waitFor(() => expect(confirmed).toHaveBeenCalled());
    expect(close).toHaveBeenCalledTimes(1); // 捨てないなら閉じない
    confirmed.mockResolvedValue(true);
    fireEvent.keyDown(box(), { key: "Escape" });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  });
});
