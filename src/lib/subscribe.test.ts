import { describe, expect, it } from "vitest";
import { safeSubscribe } from "./subscribe";

describe("safeSubscribe", () => {
  it("test_解除するとリスナーが外れる", async () => {
    let removed = false;
    const stop = safeSubscribe(async () => () => void (removed = true));
    await Promise.resolve();
    stop();
    expect(removed).toBe(true);
  });

  it("test_登録し終わる前に解除されても必ず外す", async () => {
    // **StrictMode は effect を張って即座に畳む。** 登録が Promise なので、
    // 解除のときにまだ登録が終わっていないことがある。ここで取りこぼすと
    // リスナーが二重に生き、メニューの操作が 2 回走る（実機で発覚
    // 2026-09-04: アシスタントからアウトラインへ切り替えられない）
    let removed = false;
    let finish!: (stop: () => void) => void;
    const stop = safeSubscribe(
      () => new Promise((resolve) => (finish = resolve)),
    );
    stop(); // 登録が終わる前に畳む
    finish(() => void (removed = true));
    await Promise.resolve();
    expect(removed).toBe(true);
  });

  it("test_登録に失敗しても例外を漏らさない", async () => {
    const stop = safeSubscribe(async () => {
      throw new Error("listen できない");
    });
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});
