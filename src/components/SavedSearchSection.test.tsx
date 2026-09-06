// @vitest-environment jsdom
// 保存した検索（サイドバー）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SavedSearchSection } from "./SavedSearchSection";

afterEach(cleanup);

const SEARCHES = [
  { name: "今週", query: "tag:週報" },
  { name: "予算", query: "予算 会議" },
];

describe("SavedSearchSection", () => {
  test("test_名前を並べ_押すと式が渡る", () => {
    const onRun = vi.fn();
    render(
      <SavedSearchSection
        searches={SEARCHES}
        onRun={onRun}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.click(screen.getByText("予算"));
    expect(onRun).toHaveBeenCalledWith("予算 会議");
  });

  test("test_✕ で外す", () => {
    const onRemove = vi.fn();
    render(
      <SavedSearchSection
        searches={SEARCHES}
        onRun={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getAllByTitle("この検索を外す")[0]);
    expect(onRemove).toHaveBeenCalledWith("今週");
  });
});
