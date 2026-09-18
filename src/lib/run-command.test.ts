// 押した操作の失敗をステータス欄に出す包み（棚卸し 2026-09-17 / 17-6）。
// `void handleX()` で呼ぶだけだと、Rust が断っても無反応に見えていた。

import { describe, expect, test, vi } from "vitest";
import { failureText, runWithStatus } from "./run-command";

describe("runWithStatus", () => {
  test("test_失敗したら_何が_できなかったかをステータスに出して_false", async () => {
    const setStatus = vi.fn();
    const ok = await runWithStatus(setStatus, "書き出し", async () => {
      throw new Error("disk full");
    });
    expect(ok).toBe(false);
    expect(setStatus).toHaveBeenCalledWith(
      "書き出しできませんでした: Error: disk full",
    );
  });

  test("test_成功したら黙って_true（成功の知らせは呼ぶ側が持つ）", async () => {
    const setStatus = vi.fn();
    const ok = await runWithStatus(setStatus, "書き出し", async () => {});
    expect(ok).toBe(true);
    expect(setStatus).not.toHaveBeenCalled();
  });

  test("test_文字列で投げられても読める形に", async () => {
    const setStatus = vi.fn();
    await runWithStatus(setStatus, "同期", () => Promise.reject("busy"));
    expect(setStatus).toHaveBeenCalledWith("同期できませんでした: busy");
  });
});

describe("failureText", () => {
  test("test_何が_できなかったかと理由を_1_つの形で", () => {
    expect(failureText("改名", new Error("busy"))).toBe(
      "改名できませんでした: Error: busy",
    );
  });
});
