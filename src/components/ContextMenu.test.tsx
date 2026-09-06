// @vitest-environment jsdom
// 右クリックのメニューの枠（置き場所は lib/context-menu が決める）と枝の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ContextMenu, SubMenu } from "./ContextMenu";

afterEach(cleanup);

describe("ContextMenu", () => {
  test("test_項目を並べ_測ったあとに見える", () => {
    render(
      <ContextMenu at={{ x: 10, y: 20 }} onClose={vi.fn()}>
        <li>
          <button>複製</button>
        </li>
      </ContextMenu>,
    );
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("button", { name: "複製" })).toBeTruthy();
    expect(menu.style.visibility).toBe("visible");
    expect(menu.style.left).not.toBe("");
  });

  test("test_外側を押す_右クリックで閉じ_中を押しても閉じない", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu at={{ x: 0, y: 0 }} onClose={onClose}>
        <li>
          <button>a</button>
        </li>
      </ContextMenu>,
    );
    const menu = screen.getByRole("menu");
    fireEvent.mouseDown(menu);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(menu.parentElement!);
    fireEvent.contextMenu(menu.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("SubMenu", () => {
  test("test_載せると枝が開き_離すと閉じる", () => {
    render(
      <ContextMenu at={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <SubMenu icon={<span />} label="生成AIに渡す">
          <li>
            <button>ChatGPT</button>
          </li>
        </SubMenu>
      </ContextMenu>,
    );
    expect(screen.queryByRole("button", { name: "ChatGPT" })).toBeNull();
    const item = screen.getByRole("button", {
      name: /生成AIに渡す/,
    }).parentElement!;
    fireEvent.mouseEnter(item);
    expect(screen.getByRole("button", { name: "ChatGPT" })).toBeTruthy();
    fireEvent.mouseLeave(item);
    expect(screen.queryByRole("button", { name: "ChatGPT" })).toBeNull();
  });
});
