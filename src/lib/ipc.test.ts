// Tauri コマンドの薄い包み（lib/ipc）の検証。invoke は差し替えて、
// 渡す形（コマンド名・引数・base64）と、Rust を呼ばずに済ませる判断を見る。

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { imageSource, saveAttachment, toEntry } from "./ipc";

const invoked = vi.mocked(invoke);

beforeEach(() => {
  invoked.mockReset();
});

describe("toEntry", () => {
  test("test_Rust の meta を一覧の 1 行にする（絶対パスと拡張子なしの見出し）", () => {
    expect(
      toEntry("/v", {
        path: "仕事/会議.md",
        title: "会議",
        preview: "冒頭",
        mtime_ms: 5,
        pinned: true,
      }),
    ).toEqual({
      path: "/v/仕事/会議.md",
      label: "仕事/会議",
      preview: "冒頭",
      mtimeMs: 5,
      pinned: true,
    });
  });
});

describe("saveAttachment", () => {
  test("test_中身は base64 にして attachment_save へ", async () => {
    invoked.mockResolvedValue("![](attachments/a.png)");
    const made = await saveAttachment(
      "/v",
      new Uint8Array([104, 105]),
      "a.png",
    );
    expect(made).toBe("![](attachments/a.png)");
    expect(invoked).toHaveBeenCalledWith("attachment_save", {
      root: "/v",
      data: "aGk=",
      suffix: "a.png",
    });
  });

  test("test_大きな画像も塊ごとに組んで落ちない", async () => {
    invoked.mockResolvedValue("");
    const big = new Uint8Array(0x8000 * 3 + 7).fill(65);
    await saveAttachment("/v", big, "b.png");
    const sent = invoked.mock.calls[0][1] as { data: string };
    expect(atob(sent.data).length).toBe(big.length);
  });
});

describe("imageSource", () => {
  test("test_遠隔と data は Rust を呼ばずに描かない", async () => {
    expect(await imageSource("/v", "https://example.com/a.png")).toBeNull();
    expect(await imageSource("/v", "data:image/png;base64,AA==")).toBeNull();
    expect(invoked).not.toHaveBeenCalled();
  });

  test("test_同じ参照は 1 回だけ読む（装飾の作り直しごとに往復しない）", async () => {
    invoked.mockResolvedValue("data:image/png;base64,QUJD");
    const first = await imageSource("/v", "attachments/x.png");
    const second = await imageSource("/v", "attachments/x.png");
    expect(first).toBe("data:image/png;base64,QUJD");
    expect(second).toBe(first);
    expect(invoked).toHaveBeenCalledTimes(1);
    expect(invoked).toHaveBeenCalledWith("image_read", {
      root: "/v",
      path: "attachments/x.png",
    });
  });

  test("test_読めなければ null（壊れた参照で描画ごと止めない）", async () => {
    invoked.mockRejectedValue(new Error("no file"));
    expect(await imageSource("/v", "attachments/missing.png")).toBeNull();
  });
});
