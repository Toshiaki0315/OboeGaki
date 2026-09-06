// @vitest-environment jsdom
// 検索結果の一覧（一覧ペインの中身が差し替わる）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SearchHits } from "./SearchHits";

afterEach(cleanup);

describe("SearchHits", () => {
  test("test_題と抜き書きを並べ_押すと相対パスが渡る", () => {
    const onOpen = vi.fn();
    render(
      <SearchHits
        hits={[{ path: "a/b.md", title: "会議", snippet: "…予算…" }]}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("…予算…")).toBeTruthy();
    fireEvent.click(screen.getByText("会議"));
    expect(onOpen).toHaveBeenCalledWith("a/b.md");
  });

  test("test_無ければ案内", () => {
    render(<SearchHits hits={[]} onOpen={vi.fn()} />);
    expect(screen.getByText("見つかりません")).toBeTruthy();
  });
});
