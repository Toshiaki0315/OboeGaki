// @vitest-environment jsdom
// 線で描くアイコン（メニュー・ツールバー・アシスタントで共通）の検証。

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { MENU_ICONS } from "../lib/menu-icons";
import { MenuIcon, PathIcon } from "./MenuIcon";

afterEach(cleanup);

describe("PathIcon", () => {
  test("test_渡した線をぜんぶ描く_太さの既定は 1.4", () => {
    const { container } = render(<PathIcon paths={["M1 1", "M2 2"]} />);
    const paths = container.querySelectorAll("svg path");
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute("stroke-width")).toBe("1.4");
    expect(paths[0].getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("test_太さとクラスは指定できる", () => {
    const { container } = render(
      <PathIcon paths={["M1 1"]} className="menu-icon" strokeWidth={1.3} />,
    );
    expect(container.querySelector("svg")?.getAttribute("class")).toBe(
      "menu-icon",
    );
    expect(container.querySelector("path")?.getAttribute("stroke-width")).toBe(
      "1.3",
    );
  });
});

describe("MenuIcon", () => {
  test("test_名前で引いた線を menu-icon の枠で描く", () => {
    const { container } = render(<MenuIcon name="pin" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toBe(
      "menu-icon",
    );
    expect(container.querySelectorAll("path")).toHaveLength(
      MENU_ICONS.pin.length,
    );
  });
});
