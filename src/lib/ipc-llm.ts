// Ollama（アシスタント）。繋ぐのは Rust 側（llm.rs）で、WebView から外へは出ない。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings } from "./settings";
import { safeSubscribe } from "./subscribe";

// ---- Ollama（アシスタント）。繋ぐのは Rust 側（llm.rs）で、WebView から
// 外へは出ない。

/// 生成に渡す設定（環境設定のうち LLM の項）
export type LlmSettings = Pick<
  Settings,
  "llmPort" | "llmModel" | "llmContext" | "llmTimeoutMinutes" | "llmKeepAlive"
>;

/// 生成の注文。要約・レビュー・質問で送るものは違っても、形は 1 つ
export type LlmOrder = {
  task: string;
  title: string;
  body: string;
  question?: string;
  /// 質問の材料（題名と本文の組）
  sources?: [string, string][];
};

/// Ollama が動いているか
export function llmAvailable(port: number): Promise<boolean> {
  return invoke<boolean>("llm_available", { port });
}

/// 生成を始める。始められたら true（走っている途中なら false）
export function llmGenerate(
  settings: LlmSettings,
  order: LlmOrder,
): Promise<boolean> {
  // Rust 側は 1 つの構造体（GenerateRequest）で受ける
  return invoke<boolean>("llm_generate", {
    request: {
      port: settings.llmPort,
      model: settings.llmModel,
      context: settings.llmContext,
      timeoutMinutes: settings.llmTimeoutMinutes,
      keepAlive: settings.llmKeepAlive,
      ...order,
    },
  });
}

/// 走っている生成を止める（L-1）。止める操作で落ちないよう、失敗は飲む
export async function llmStop(): Promise<void> {
  try {
    await invoke("llm_stop");
  } catch {
    // 既に終わっていた・繋がっていない。どちらも「止まっている」
  }
}

/// モデルが載っているか（載っていなければ最初の 1 文字まで数分かかる）
export function llmLoaded(port: number, model: string): Promise<boolean> {
  return invoke<boolean>("llm_loaded", { port, model });
}

/// モデルを降ろす。降ろせたら true（生成中なら false）
export function llmUnload(port: number, model: string): Promise<boolean> {
  return invoke<boolean>("llm_unload", { port, model });
}

/// Ollama に入っているモデル名
export function llmModels(port: number): Promise<string[]> {
  return invoke<string[]>("llm_models", { port });
}

/// 生成の出来事を受ける。返り値で購読を外す
export function subscribeLlm(handlers: {
  onChunk: (piece: string) => void;
  onDone: () => void;
  onFailed: (reason: string) => void;
}): () => void {
  const stops = [
    safeSubscribe(() =>
      listen<string>("llm-chunk", (event) => handlers.onChunk(event.payload)),
    ),
    safeSubscribe(() => listen<string>("llm-done", () => handlers.onDone())),
    safeSubscribe(() =>
      listen<string>("llm-failed", (event) => handlers.onFailed(event.payload)),
    ),
  ];
  return () => stops.forEach((stop) => stop());
}
