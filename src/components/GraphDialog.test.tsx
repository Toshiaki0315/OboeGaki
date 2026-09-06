// @vitest-environment jsdom
// リンクの図（M-2）の窓の検証。図そのものは Mermaid が描いた SVG を受け取る。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GraphDialog, type GraphDialogProps } from "./GraphDialog";

afterEach(cleanup);

function setup(over: Partial<GraphDialogProps> = {}) {
  const props: GraphDialogProps = {
    svg: '<svg data-testid="g"></svg>',
    dropped: 0,
    depth: 2,
    onDepth: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<GraphDialog {...props} />);
  return props;
}

describe("GraphDialog", () => {
  test("test_受け取った SVG をそのまま埋める", () => {
    setup();
    expect(screen.getByTestId("g")).toBeTruthy();
  });

  test("test_省いた件数を黙らない", () => {
    setup({ dropped: 12 });
    expect(screen.getByText("多いので 12 件を省いています。")).toBeTruthy();
  });

  test("test_省いていなければ範囲の説明", () => {
    setup();
    expect(
      screen.getByText("開いているノートから辿れる範囲です。"),
    ).toBeTruthy();
  });

  test("test_狭く_広くで深さを 1 段ずつ変える", () => {
    const props = setup({ depth: 2 });
    fireEvent.click(screen.getByRole("button", { name: "狭く" }));
    expect(props.onDepth).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "広く（2 段）" }));
    expect(props.onDepth).toHaveBeenCalledWith(3);
  });

  test("test_深さの両端では押せない", () => {
    setup({ depth: 1 });
    expect(
      (screen.getByRole("button", { name: "狭く" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    cleanup();
    setup({ depth: 4 });
    expect(
      (screen.getByRole("button", { name: /広く/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("test_閉じると外側で閉じる", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
