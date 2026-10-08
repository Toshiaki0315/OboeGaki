// 音声・動画から議事録のノートを作る（TASKS 28-4 / ADR-0070）。
//
// 使えるか確かめる → ファイルを選ぶ → 添付に写すか聞く（大きさを見せる。決定 4）→
// 文字起こし（この Mac の中）→ 議事録（手元の Ollama・議事録のモデル。決定 2・3）→
// 選んでいるフォルダにノートを作って開く。議事録が作れなくても、起こした文は捨てない。
// 進み具合は progress（窓に出す）。止めるは文字起こしと議事録の両方に効く。

import { useState } from "react";
import {
  attachmentCopy,
  confirmDialog,
  createNote,
  fileSize,
  llmAvailable,
  llmModels,
  llmStop,
  minutesMake,
  pickFile,
  subscribeTranscribe,
  transcribeFile,
  transcribeProbe,
  transcribeStop,
  writeNote,
  type MinutesStage,
} from "../lib/ipc";
import { minutesNote } from "../lib/minutes-note";
import { minutesModelOf, type Settings } from "../lib/settings";
import { useLatest } from "./useLatest";

/// 選べる音声・動画（AVFoundation が読めるもの）
export const MEDIA_EXTENSIONS = [
  "m4a",
  "mp3",
  "wav",
  "aac",
  "aiff",
  "caf",
  "mp4",
  "mov",
  "m4v",
];

export type TranscribeInput = {
  vaultRoot: string | null;
  settings: Settings;
  /// 作るノートの置き場（選んでいるフォルダ。18-2）
  defaultFolder: () => string;
  refreshLists: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
  onStatus: (text: string) => void;
  /// 今日（YYYY-MM-DD）。テストで差し替える
  today?: () => string;
};

/// 窓に出す進み具合。done は文字起こしの割合（0〜1）、議事録の間は null
export type TranscribeProgress = { label: string; done: number | null };

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function stageLabel(stage: MinutesStage): string {
  switch (stage.kind) {
    case "chunk":
      return `議事録: 区切り ${stage.at[0]}/${stage.at[1]} の要点を抜き出しています…`;
    case "merge":
      return "議事録: まとめています…";
    default:
      return "議事録を作っています…";
  }
}

export function useTranscribe(input: TranscribeInput) {
  const latest = useLatest(input);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);

  async function start() {
    const { vaultRoot, settings, onStatus } = latest.current;
    if (!vaultRoot) return;
    try {
      await transcribeProbe();
    } catch (reason) {
      onStatus(String(reason));
      return;
    }
    const picked = await pickFile({
      filters: [{ name: "音声・動画", extensions: MEDIA_EXTENSIONS }],
    });
    if (!picked) return;
    const name = picked.split("/").pop() ?? picked;
    const size = await fileSize(picked).catch(() => 0);
    const megabytes = Math.max(1, Math.round(size / (1024 * 1024)));
    const copy = await confirmDialog(
      `「${name}」（${megabytes} MB）を保管フォルダの添付に写しますか？\n写すと、あとで聞き直せます。「キャンセル」なら写さずに、名前だけを書き残します。`,
      { title: "文字起こし", kind: "info" },
    );

    setProgress({ label: "文字起こししています…", done: 0 });
    const unsubscribe = subscribeTranscribe({
      onProgress: (done) =>
        setProgress((current) => (current ? { ...current, done } : current)),
      onStage: (stage) => setProgress({ label: stageLabel(stage), done: null }),
    });
    try {
      let transcription;
      try {
        transcription = await transcribeFile(picked);
      } catch (reason) {
        onStatus(String(reason));
        return;
      }

      // 議事録（作れなくても起こした文は捨てない）
      let minutes: string | null = null;
      let missing: string | null = null;
      if (!settings.assistantEnabled) {
        missing = "アシスタントを切っています";
      } else if (!(await llmAvailable(settings.llmPort).catch(() => false))) {
        missing = "アシスタント（Ollama）が動いていません";
      } else {
        const installed = await llmModels(settings.llmPort).catch(() => []);
        const model = minutesModelOf(settings, installed);
        setProgress({ label: `議事録を作っています（${model}）…`, done: null });
        try {
          minutes = await minutesMake({
            lines: transcription.lines,
            port: settings.llmPort,
            model,
            timeoutMinutes: settings.llmTimeoutMinutes,
            keepAlive: settings.llmKeepAlive,
          });
        } catch (reason) {
          missing = String(reason);
        }
      }

      let attachment: string | null = null;
      let copyFailed: string | null = null;
      if (copy) {
        attachment = await attachmentCopy(vaultRoot, picked).catch((reason) => {
          copyFailed = String(reason);
          return null;
        });
      }

      const note = minutesNote({
        date: (latest.current.today ?? localToday)(),
        sourceName: name,
        duration: transcription.duration,
        attachment,
        minutes,
        lines: transcription.lines,
      });
      const path = await createNote(
        vaultRoot,
        note.title,
        latest.current.defaultFolder(),
      );
      await writeNote(vaultRoot, path, note.text, settings.historyMinutes);
      await latest.current.refreshLists();
      await latest.current.openNote(path);
      const told = minutes
        ? "議事録を作りました（話者は分かれていません。手で確かめて直してください）"
        : `文字起こしだけを作りました（${missing}）`;
      onStatus(
        copyFailed ? `${told}。添付に写せませんでした: ${copyFailed}` : told,
      );
    } finally {
      unsubscribe();
      setProgress(null);
    }
  }

  /// 止める（文字起こしの子プロセスと、議事録の生成の両方）。もう終わっていても困らない
  async function stop() {
    try {
      await transcribeStop();
    } catch {
      // もう終わっていた
    }
    await llmStop();
  }

  return { progress, start, stop };
}
