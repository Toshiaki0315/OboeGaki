// @vitest-environment jsdom
// 文字起こしと議事録の進み具合の窓（TASKS 28-4）。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TranscribeProgressDialog } from "./TranscribeProgressDialog";

describe("TranscribeProgressDialog", () => {
  test("test_何をしているかと割合を出し_止められる", () => {
    const onStop = vi.fn();
    render(
      <TranscribeProgressDialog
        progress={{ label: "文字起こししています…", done: 0.35 }}
        onStop={onStop}
      />,
    );
    expect(screen.getByText("文字起こししています…")).toBeTruthy();
    expect(screen.getByText("35%")).toBeTruthy();
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(
      0.35,
    );
    fireEvent.click(screen.getByRole("button", { name: "止める" }));
    expect(onStop).toHaveBeenCalled();
  });

  test("test_議事録の間は割合を出さない（いつ終わるか分からない）", () => {
    render(
      <TranscribeProgressDialog
        progress={{ label: "議事録: まとめています…", done: null }}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(
      (screen.getByRole("progressbar") as HTMLProgressElement).hasAttribute(
        "value",
      ),
    ).toBe(false);
  });

  test("test_音声は外へ出さないと添える", () => {
    render(
      <TranscribeProgressDialog
        progress={{ label: "文字起こししています…", done: 0 }}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText(/この Mac の中だけ/)).toBeTruthy();
  });
});
