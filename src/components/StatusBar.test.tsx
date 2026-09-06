// @vitest-environment jsdom
// ステータスバー（窓の全幅・左端に歯車 = 参照実装と同じ）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { StatusBar, type StatusBarProps } from "./StatusBar";

afterEach(cleanup);

function setup(over: Partial<StatusBarProps> = {}) {
  const props: StatusBarProps = {
    status: "",
    stats: null,
    savedAt: null,
    onMenu: vi.fn(),
    ...over,
  };
  const view = render(<StatusBar {...props} />);
  return { props, view };
}

describe("StatusBar", () => {
  test("test_知らせを出す", () => {
    setup({ status: "保存しました" });
    expect(screen.getByText("保存しました")).toBeTruthy();
  });

  test("test_ノートを開いていれば字数と行数", () => {
    const { view } = setup({ stats: { characters: 12, lines: 3 } });
    expect(view.container.querySelector(".status-stats")?.textContent).toBe(
      "12 文字 / 3 行",
    );
  });

  test("test_原稿用紙 1 枚を超えたら枚数を足す（7-3）", () => {
    const { view } = setup({ stats: { characters: 800, lines: 40 } });
    expect(view.container.querySelector(".status-stats")?.textContent).toBe(
      "800 文字 / 40 行 / 2 枚",
    );
  });

  test("test_開いていなければ字数は出さない", () => {
    const { view } = setup({ stats: null, savedAt: null });
    expect(view.container.querySelector(".status-stats")?.textContent).toBe("");
  });

  test("test_保存時刻は時:分だけ（日付は出さない）", () => {
    const at = new Date(2026, 8, 7, 9, 5).getTime();
    const { view } = setup({ stats: { characters: 1, lines: 1 }, savedAt: at });
    expect(view.container.querySelector(".status-stats")?.textContent).toBe(
      "1 文字 / 1 行 ・ 保存 09:05",
    );
  });

  test("test_歯車を押すと押した場所を知らせる", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(props.onMenu).toHaveBeenCalledWith({
      left: expect.any(Number),
      top: expect.any(Number),
    });
  });
});
