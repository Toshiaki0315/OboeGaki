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

/// 読み取りの失敗を人の言葉にする（ADR-0027 決定 4:「読み取りできません」
/// と出す）。Rust の LlmError の表示（not-running / timed-out / failed: …）
/// を受ける。読み取りと関係ない失敗なら null（呼び出し側の言葉で）
export function ocrFailureText(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("not-running")) {
    return "読み取りできません: Ollama が動いていません。環境設定の「文字の読み取り」を確かめてください";
  }
  if (text.includes("timed-out")) {
    return "読み取りできません: 時間切れです（環境設定の「応答待ち時間」を延ばせます）";
  }
  const failed = text.indexOf("failed: ");
  if (failed >= 0) {
    return `読み取りできません: ${text.slice(failed + "failed: ".length)}`;
  }
  return null;
}
