// @vitest-environment jsdom
// 保管フォルダ全体の置換（ADR-0055 / 12-3）。検索欄の字を置き換える。

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReplacePanel } from "./ReplacePanel";

afterEach(cleanup);
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function setup(query = "旧い") {
  const onPreview = vi.fn(async () => ({ notes: 2, occurrences: 3 }));
  const onApply = vi.fn(async () => undefined);
  render(
    <ReplacePanel query={query} onPreview={onPreview} onApply={onApply} />,
  );
  return { onPreview, onApply };
}

describe("ReplacePanel", () => {
  test("test_開くと件数を先に見せ_置換後の字を入れると押せる", async () => {
    const { onPreview, onApply } = setup();
    await settle();
    expect(onPreview).toHaveBeenCalledWith({
      caseSensitive: false,
      includeCode: false,
    });
    expect(screen.getByText("2 件のノート・3 箇所")).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "置換する",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // 置換後が空
    fireEvent.change(screen.getByLabelText("置換後"), {
      target: { value: "新しい" },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith("新しい", {
      caseSensitive: false,
      includeCode: false,
    });
  });

  test("test_大小の区別とコードの中もを切り替えると数え直す", async () => {
    const { onPreview } = setup();
    await settle();
    fireEvent.click(screen.getByLabelText("大小を区別"));
    await settle();
    expect(onPreview).toHaveBeenLastCalledWith({
      caseSensitive: true,
      includeCode: false,
    });
    fireEvent.click(screen.getByLabelText("コードの中も"));
    await settle();
    expect(onPreview).toHaveBeenLastCalledWith({
      caseSensitive: true,
      includeCode: true,
    });
  });

  test("test_該当が無ければ押せない", async () => {
    const onPreview = vi.fn(async () => ({ notes: 0, occurrences: 0 }));
    render(
      <ReplacePanel query="無い" onPreview={onPreview} onApply={vi.fn()} />,
    );
    await settle();
    fireEvent.change(screen.getByLabelText("置換後"), {
      target: { value: "x" },
    });
    expect(
      (screen.getByRole("button", { name: "置換する" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("該当なし")).toBeTruthy();
  });
});
