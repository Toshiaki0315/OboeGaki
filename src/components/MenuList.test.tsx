// @vitest-environment jsdom
// 右クリックメニューの項目（配列から描く）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MenuList, type MenuEntry } from "./MenuList";

afterEach(cleanup);

function setup(items: MenuEntry[]) {
  const onPick = vi.fn();
  const view = render(
    <ul>
      <MenuList items={items} onPick={onPick} />
    </ul>,
  );
  return { onPick, view };
}

describe("MenuList", () => {
  test("test_項目と区切りを並べる", () => {
    const { view } = setup([
      { label: "複製", onSelect: vi.fn() },
      { kind: "separator" },
      { label: "削除", onSelect: vi.fn(), danger: true },
    ]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(view.container.querySelectorAll("li.separator")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "削除" }).className).toBe(
      "danger",
    );
  });

  test("test_押すとまず閉じてから動く", () => {
    const calls: string[] = [];
    const { onPick } = setup([
      { label: "複製", onSelect: () => calls.push("action") },
    ]);
    onPick.mockImplementation(() => calls.push("close"));
    fireEvent.click(screen.getByRole("button", { name: "複製" }));
    expect(calls).toEqual(["close", "action"]);
  });

  test("test_押せない項目は理由を title で見せる", () => {
    const onSelect = vi.fn();
    setup([
      {
        label: "ゴミ箱へ移動",
        onSelect,
        disabled: true,
        title: "ピン留め中は捨てられません",
      },
    ]);
    const button = screen.getByTitle(
      "ピン留め中は捨てられません",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("test_印は幅を持つ枠に入れる（付いていなくても枠は出す）", () => {
    const { view } = setup([
      { label: "サイドバー", onSelect: vi.fn(), checked: true },
      { label: "アウトライン", onSelect: vi.fn(), checked: false },
      { label: "環境設定…", onSelect: vi.fn() },
    ]);
    const checks = view.container.querySelectorAll(".menu-check");
    expect(checks).toHaveLength(2);
    expect(checks[0].textContent).toBe("✓");
    expect(checks[1].textContent).toBe("");
  });

  test("test_枝の中の項目も閉じてから動く", () => {
    const onSelect = vi.fn();
    const { onPick } = setup([
      {
        kind: "submenu",
        label: "生成AIに渡す",
        icon: <span />,
        items: [{ label: "ChatGPT", onSelect }],
      },
    ]);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /生成AIに渡す/ }).parentElement!,
    );
    fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
