// PDF の取り込みで、文字の無いページだけを読み取りに回す（ADR-0027 追記）。
// **読めたページは捨てない** — 読み取りが失敗しても、文字の取れたページは残す。

import { describe, expect, test, vi } from "vitest";
import { fillBlankPages, OCR_THRESHOLD } from "./pdf-import";

const long = "あ".repeat(OCR_THRESHOLD);

describe("fillBlankPages", () => {
  test("test_文字のあるページはそのまま_無いページだけ読み取りに回す", async () => {
    const read = vi.fn(async (page: number) => `読んだ${page}`);
    const found = await fillBlankPages([long, "", "  "], 3, read);
    expect(found.texts).toEqual([long, "読んだ2", "読んだ3"]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(found.failed).toBe(0);
  });

  test("test_pdf_js が 0 ページでも Rust の数え直しで回す", async () => {
    const read = vi.fn(async () => "読んだ");
    const found = await fillBlankPages([], 2, read);
    expect(found.texts).toEqual(["読んだ", "読んだ"]);
  });

  test("test_読み取りが元より短ければ元を残す", async () => {
    const few = "少し";
    const found = await fillBlankPages([few], 1, async () => "少");
    expect(found.texts).toEqual([few]);
  });

  test("test_あるページの読み取りが失敗しても_他のページは残す（レビュー 2026-09-07）", async () => {
    const read = vi.fn(async (page: number) => {
      if (page === 2) throw new Error("not-running");
      return `読んだ${page}`;
    });
    const found = await fillBlankPages([long, "", ""], 3, read);
    expect(found.texts).toEqual([long, "", "読んだ3"]);
    expect(found.failed).toBe(1);
    expect(String(found.error)).toContain("not-running");
  });

  test("test_進み具合をページごとに知らせる", async () => {
    const seen: number[] = [];
    await fillBlankPages(
      ["", ""],
      2,
      async () => "x",
      (page) => seen.push(page),
    );
    expect(seen).toEqual([1, 2]);
  });
});
