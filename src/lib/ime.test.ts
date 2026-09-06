// 変換中の Enter を見分ける（T5）。打鍵そのものは再現できないので、
// ブラウザが出す出来事の並びを写して確かめる。

import { describe, expect, test } from "vitest";
import { imeEnterGuard } from "./ime";

const enter = (
  over: Partial<
    Parameters<ReturnType<typeof imeEnterGuard>["isImeEnter"]>[0]
  > = {},
) => ({
  key: "Enter",
  keyCode: 13,
  isComposing: false,
  timeStamp: 1000,
  ...over,
});

describe("imeEnterGuard", () => {
  test("test_確定後の素の Enter は IME のものではない", () => {
    expect(imeEnterGuard().isImeEnter(enter())).toBe(false);
  });

  test("test_Enter でなければ関係ない", () => {
    expect(imeEnterGuard().isImeEnter(enter({ key: "a" }))).toBe(false);
  });

  test("test_標準_isComposing が立っていれば IME", () => {
    expect(imeEnterGuard().isImeEnter(enter({ isComposing: true }))).toBe(true);
  });

  test("test_WebKit_keyCode 229 は変換中の打鍵", () => {
    expect(imeEnterGuard().isImeEnter(enter({ keyCode: 229 }))).toBe(true);
  });

  test("test_WebKit_compositionend の直後に届く Enter は確定のもの", () => {
    const guard = imeEnterGuard();
    guard.onCompositionEnd({ timeStamp: 1000 });
    expect(guard.isImeEnter(enter({ timeStamp: 1005 }))).toBe(true);
  });

  test("test_確定からしばらく経った Enter は人が押したもの", () => {
    const guard = imeEnterGuard();
    guard.onCompositionEnd({ timeStamp: 1000 });
    expect(guard.isImeEnter(enter({ timeStamp: 1400 }))).toBe(false);
  });
});
