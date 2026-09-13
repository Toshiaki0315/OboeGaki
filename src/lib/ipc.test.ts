// Tauri コマンドの薄い包み（lib/ipc）の検証。invoke は差し替えて、
// 渡す形（コマンド名・引数・base64）と、Rust を呼ばずに済ませる判断を見る。

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(unlisten)),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  historyUsage,
  mcpHidden,
  setMcpHidden,
  imageSource,
  llmAvailable,
  llmGenerate,
  llmLoaded,
  llmModels,
  llmStop,
  llmUnload,
  ocrImage,
  ocrPdfPage,
  saveAttachment,
  subscribeVaultChanged,
  toEntry,
} from "./ipc";

const invoked = vi.mocked(invoke);
const listened = vi.mocked(listen);

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

describe("LLM の包み", () => {
  test("test_llmAvailable は port を渡す", async () => {
    invoked.mockResolvedValue(true);
    expect(await llmAvailable(11434)).toBe(true);
    expect(invoked).toHaveBeenCalledWith("llm_available", { port: 11434 });
  });

  test("test_llmGenerate は設定と注文を 1 つにして渡す", async () => {
    invoked.mockResolvedValue(true);
    await llmGenerate(
      {
        llmPort: 1,
        llmModel: "m",
        llmContext: 8192,
        llmTimeoutMinutes: 6,
        llmKeepAlive: "5m",
      },
      { task: "summary", title: "題", body: "本文" },
    );
    expect(invoked).toHaveBeenCalledWith("llm_generate", {
      port: 1,
      model: "m",
      context: 8192,
      timeoutMinutes: 6,
      keepAlive: "5m",
      task: "summary",
      title: "題",
      body: "本文",
    });
  });

  test("test_llmStop は失敗しても投げない（止める操作で落ちない）", async () => {
    invoked.mockRejectedValue(new Error("gone"));
    await expect(llmStop()).resolves.toBeUndefined();
  });

  test("test_llmLoaded / llmUnload / llmModels / historyUsage の相手先", async () => {
    invoked.mockResolvedValue(true);
    await llmLoaded(1, "m");
    await llmUnload(1, "m");
    await llmModels(1);
    await historyUsage("/v");
    expect(invoked.mock.calls.map((call) => call[0])).toEqual([
      "llm_loaded",
      "llm_unload",
      "llm_models",
      "history_usage",
    ]);
    expect(invoked).toHaveBeenCalledWith("llm_loaded", { port: 1, model: "m" });
    expect(invoked).toHaveBeenCalledWith("history_usage", { root: "/v" });
  });
});

describe("subscribeVaultChanged", () => {
  test("test_vault-changed の payload を渡し_外すと止まる", async () => {
    const seen: unknown[] = [];
    const stop = subscribeVaultChanged((change) => seen.push(change));
    await Promise.resolve();
    const registered = listened.mock.calls.find(
      (c) => c[0] === "vault-changed",
    );
    expect(registered).toBeTruthy();
    const handler = registered![1] as (e: { payload: unknown }) => void;
    handler({ payload: { path: "/v/a.md", kind: "modified" } });
    expect(seen).toEqual([{ path: "/v/a.md", kind: "modified" }]);
    stop();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("読み取りの包み", () => {
  const reader = {
    engine: "llm" as const,
    port: 1,
    model: "m",
    context: 4096,
    timeoutMinutes: 1,
    keepAlive: "5m",
  };
  test("test_ocrImage は読み手ごと渡す", async () => {
    invoked.mockResolvedValue("読めた");
    expect(await ocrImage("QUJD", reader)).toBe("読めた");
    expect(invoked).toHaveBeenCalledWith("ocr_image", { data: "QUJD", reader });
  });
  test("test_ocrPdfPage はページ番号（1 始まり）と読み手を渡す", async () => {
    invoked.mockResolvedValue("");
    await ocrPdfPage("QUJD", 2, reader);
    expect(invoked).toHaveBeenCalledWith("ocr_pdf_page", {
      data: "QUJD",
      page: 2,
      reader,
    });
  });
});

describe("MCP に渡さないもの（.mcp-ignore）", () => {
  test("test_一覧を聞く", async () => {
    invoked.mockResolvedValue({ listed: ["秘密"], builtin: [".trash"] });
    expect(await mcpHidden("/v")).toEqual({
      listed: ["秘密"],
      builtin: [".trash"],
    });
    expect(invoked).toHaveBeenCalledWith("mcp_hidden", { root: "/v" });
  });

  test("test_付け外しは道と真偽を渡し_新しい一覧を受け取る", async () => {
    invoked.mockResolvedValue({
      listed: ["秘密", "仕事/評価"],
      builtin: [],
    });
    expect(await setMcpHidden("/v", "仕事/評価", true)).toEqual({
      listed: ["秘密", "仕事/評価"],
      builtin: [],
    });
    expect(invoked).toHaveBeenCalledWith("mcp_set_hidden", {
      root: "/v",
      path: "仕事/評価",
      hidden: true,
    });
  });
});
