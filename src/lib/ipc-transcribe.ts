// 音声・動画の文字起こしと議事録（TASKS 第 28 群 / ADR-0070）。文字起こしは同梱の
// Swift の部品、議事録は手元の Ollama。どちらも Rust 側で呼び、音声は外へ出さない。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeSubscribe } from "./subscribe";

/// 文字起こしが使えるか（macOS 26・日本語の言語データ）。使えなければ理由で reject
export async function transcribeProbe(): Promise<void> {
  await invoke("transcribe_probe");
}

export type Transcription = {
  /// 録音の長さ（秒）
  duration: number;
  /// `[mm:ss] 文` を 1 行ずつ
  lines: string;
};

/// 文字起こしする（進み具合は subscribeTranscribe で受ける）
export function transcribeFile(path: string): Promise<Transcription> {
  return invoke<Transcription>("transcribe_file", { path });
}

export async function transcribeStop(): Promise<void> {
  await invoke("transcribe_stop");
}

/// 議事録の段（Rust の minutes::Stage）
export type MinutesStage =
  | { kind: "single" }
  | { kind: "chunk"; at: [number, number] }
  | { kind: "merge" };

export type MinutesRequest = {
  lines: string;
  port: number;
  model: string;
  timeoutMinutes: number;
  keepAlive: string;
};

/// 文字起こしから議事録を作る（長ければ区切って 2 段）。止めるのは llmStop
export function minutesMake(request: MinutesRequest): Promise<string> {
  return invoke<string>("minutes_make", { request });
}

/// ファイルの大きさ（バイト）
export function fileSize(path: string): Promise<number> {
  return invoke<number>("file_size", { path });
}

/// 保管フォルダの外のファイルを添付に写す。保管フォルダからの相対パスを返す
export function attachmentCopy(root: string, path: string): Promise<string> {
  return invoke<string>("attachment_copy", { root, path });
}

/// 文字起こしの進み具合（0〜1）と議事録の段を受ける
export function subscribeTranscribe(handlers: {
  onProgress: (done: number) => void;
  onStage: (stage: MinutesStage) => void;
}): () => void {
  const stops = [
    safeSubscribe(() =>
      listen<number>("transcribe-progress", (event) =>
        handlers.onProgress(event.payload),
      ),
    ),
    safeSubscribe(() =>
      listen<MinutesStage>("minutes-stage", (event) =>
        handlers.onStage(event.payload),
      ),
    ),
  ];
  return () => stops.forEach((stop) => stop());
}
