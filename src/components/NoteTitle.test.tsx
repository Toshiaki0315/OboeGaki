// @vitest-environment jsdom
// 題名の欄（改名 ↔ H1 同期 = ADR-0005 の入口）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NoteTitle } from "./NoteTitle";

afterEach(cleanup);

describe("NoteTitle", () => {
  test("test_ファイル名の幹が入っている", () => {
    render(<NoteTitle path="/v/仕事/会議.md" onRename={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "会議",
    );
  });

  test("test_Enter でフォーカスが外れ_そのときに 1 回だけ改名する", () => {
    const onRename = vi.fn();
    render(<NoteTitle path="/v/a.md" onRename={onRename} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "b" } });
    expect(onRename).not.toHaveBeenCalled(); // 打っている途中では改名しない
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("b");
  });

  test("test_T5_変換中の Enter は確定であって改名ではない（実機報告 2026-09-07）", () => {
    // 日本語を打って未確定のまま Enter を押すと、確定と同時に欄から
    // フォーカスが外れて改名まで走っていた。変換中の Enter は IME のもの
    const onRename = vi.fn();
    render(<NoteTitle path="/v/a.md" onRename={onRename} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "かいぎ" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(document.activeElement).toBe(input);
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" }); // 確定後の Enter で外れる
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
