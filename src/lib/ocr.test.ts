// 読み取りの読み手（ADR-0027 決定 1）を環境設定から組む。

import { describe, expect, test } from "vitest";
import { ocrReaderFrom } from "./ocr";
import { DEFAULT_SETTINGS } from "./settings";

describe("ocrReaderFrom", () => {
  test("test_ローカルLLM を選んでいれば LLM の設定ごと渡す", () => {
    const reader = ocrReaderFrom({
      ...DEFAULT_SETTINGS,
      assistantEnabled: true,
      ocrEngine: "llm",
      llmPort: 11434,
      llmModel: "qwen2.5vl",
      llmContext: 8192,
      llmTimeoutMinutes: 6,
      llmKeepAlive: "5m",
    });
    expect(reader).toEqual({
      engine: "llm",
      port: 11434,
      model: "qwen2.5vl",
      context: 8192,
      timeoutMinutes: 6,
      keepAlive: "5m",
    });
  });

  test("test_macOS を選んでいれば engine は mac", () => {
    expect(
      ocrReaderFrom({ ...DEFAULT_SETTINGS, ocrEngine: "mac" }).engine,
    ).toBe("mac");
  });

  test("test_アシスタントを切ってあれば LLM は選べず macOS で読む", () => {
    // 切ってある = Ollama に触らない約束。読み取りだけ例外にしない
    expect(
      ocrReaderFrom({
        ...DEFAULT_SETTINGS,
        assistantEnabled: false,
        ocrEngine: "llm",
      }).engine,
    ).toBe("mac");
  });
});
