// @vitest-environment jsdom
// バックリンク（E-6。本文の下に畳んで出す）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BacklinkBar } from "./BacklinkBar";

afterEach(cleanup);

const LINKS = [
  { path: "a.md", title: "会議", context: "…[[題]]を参照…", relation: "" },
  { path: "b.md", title: "計画", context: "…", relation: "親" },
];

describe("BacklinkBar", () => {
  test("test_件数と_題と_文脈を出す", () => {
    render(<BacklinkBar backlinks={LINKS} onOpen={vi.fn()} />);
    expect(screen.getByText("バックリンク（2）")).toBeTruthy();
    expect(screen.getByText("…[[題]]を参照…")).toBeTruthy();
  });

  test("test_続柄は付いているものだけ（M-3）", () => {
    const { container } = render(
      <BacklinkBar backlinks={LINKS} onOpen={vi.fn()} />,
    );
    expect(container.querySelectorAll(".backlink-relation")).toHaveLength(1);
    expect(screen.getByText("親")).toBeTruthy();
  });

  test("test_押すとそのノートの道が渡る", () => {
    const onOpen = vi.fn();
    render(<BacklinkBar backlinks={LINKS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("計画"));
    expect(onOpen).toHaveBeenCalledWith("b.md");
  });
});
