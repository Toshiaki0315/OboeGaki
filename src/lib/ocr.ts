// 文字の読み取り（OCR）の読み手を環境設定から組む（ADR-0027 決定 1）。
// 読むのは Rust 側（Vision か、Ollama に画像を添える）。

import type { Settings } from "./settings";

/// Rust の `ocr_image` / `ocr_pdf_page` に渡す読み手
export type OcrReader = {
  engine: "mac" | "llm";
  port: number;
  model: string;
  context: number;
  timeoutMinutes: number;
  keepAlive: string;
};

/// **アシスタントを切ってあれば LLM は選べない** — 切ってある = Ollama に
/// 触らない約束で、読み取りだけを例外にしない。そのときは macOS で読む
export function ocrReaderFrom(settings: Settings): OcrReader {
  return {
    engine: settings.assistantEnabled ? settings.ocrEngine : "mac",
    port: settings.llmPort,
    model: settings.llmModel,
    context: settings.llmContext,
    timeoutMinutes: settings.llmTimeoutMinutes,
    keepAlive: settings.llmKeepAlive,
  };
}
