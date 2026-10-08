// @vitest-environment jsdom
// 音声・動画から議事録のノートを作る流れ（TASKS 28-4 / ADR-0070）。IPC は偽物。

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as ipc from "../lib/ipc";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { useTranscribe, type TranscribeInput } from "./useTranscribe";

vi.mock("../lib/ipc", () => ({
  transcribeProbe: vi.fn(),
  transcribeFile: vi.fn(),
  transcribeStop: vi.fn(),
  minutesMake: vi.fn(),
  fileSize: vi.fn(),
  attachmentCopy: vi.fn(),
  subscribeTranscribe: vi.fn(() => () => {}),
  pickFile: vi.fn(),
  confirmDialog: vi.fn(),
  llmAvailable: vi.fn(),
  llmModels: vi.fn(),
  llmStop: vi.fn(),
  createNote: vi.fn(),
  writeNote: vi.fn(),
}));

const mocked = vi.mocked(ipc);

function input(over: Partial<TranscribeInput> = {}): TranscribeInput {
  return {
    vaultRoot: "/v",
    settings: DEFAULT_SETTINGS,
    defaultFolder: () => "仕事",
    refreshLists: vi.fn(async () => {}),
    openNote: vi.fn(async () => {}),
    onStatus: vi.fn(),
    today: () => "2026-10-09",
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.subscribeTranscribe.mockReturnValue(() => {});
  mocked.transcribeProbe.mockResolvedValue(undefined);
  mocked.pickFile.mockResolvedValue("/Users/me/Downloads/定例.m4a");
  mocked.fileSize.mockResolvedValue(40 * 1024 * 1024);
  mocked.confirmDialog.mockResolvedValue(true);
  mocked.transcribeFile.mockResolvedValue({
    duration: 1257,
    lines: "[00:00] 予算の話\n",
  });
  mocked.llmAvailable.mockResolvedValue(true);
  mocked.llmModels.mockResolvedValue(["gemma3:4b", "gemma3:12b"]);
  mocked.minutesMake.mockResolvedValue("## 要旨\n\n予算の話。\n");
  mocked.attachmentCopy.mockResolvedValue("attachments/20261009-070000.m4a");
  mocked.createNote.mockResolvedValue("/v/仕事/議事録 2026-10-09 定例.md");
  mocked.writeNote.mockResolvedValue(undefined);
});

describe("useTranscribe", () => {
  test("test_選んだ録音を起こして議事録にし_選んでいるフォルダにノートを作って開く", async () => {
    const given = input();
    const { result } = renderHook(() => useTranscribe(given));
    await act(() => result.current.start());

    expect(mocked.transcribeFile).toHaveBeenCalledWith(
      "/Users/me/Downloads/定例.m4a",
    );
    // 議事録は「議事録のモデル」（自動 = gemma3:12b）で
    expect(mocked.minutesMake).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: "[00:00] 予算の話\n",
        model: "gemma3:12b",
        port: DEFAULT_SETTINGS.llmPort,
      }),
    );
    expect(mocked.attachmentCopy).toHaveBeenCalledWith(
      "/v",
      "/Users/me/Downloads/定例.m4a",
    );
    expect(mocked.createNote).toHaveBeenCalledWith(
      "/v",
      "議事録 2026-10-09 定例",
      "仕事",
    );
    const [, path, text] = mocked.writeNote.mock.calls[0];
    expect(path).toBe("/v/仕事/議事録 2026-10-09 定例.md");
    expect(text).toContain(
      "[元の録音（21 分）](attachments/20261009-070000.m4a)",
    );
    expect(text).toContain("## 要旨");
    expect(text).toContain(":::details 文字起こし");
    expect(given.openNote).toHaveBeenCalledWith(
      "/v/仕事/議事録 2026-10-09 定例.md",
    );
    expect(result.current.progress).toBeNull(); // 終わったら窓を閉じる
  });

  test("test_写す前に大きさを見せて確かめる", async () => {
    const { result } = renderHook(() => useTranscribe(input()));
    await act(() => result.current.start());
    expect(mocked.confirmDialog).toHaveBeenCalledWith(
      expect.stringContaining("40 MB"),
      expect.anything(),
    );
  });

  test("test_写さないを選べば名前だけを書き残す", async () => {
    mocked.confirmDialog.mockResolvedValue(false);
    const { result } = renderHook(() => useTranscribe(input()));
    await act(() => result.current.start());
    expect(mocked.attachmentCopy).not.toHaveBeenCalled();
    expect(mocked.writeNote.mock.calls[0][2]).toContain(
      "元の録音: 定例.m4a（21 分）",
    );
  });

  test("test_使えなければ理由を言い_ファイルも選ばせない", async () => {
    mocked.transcribeProbe.mockRejectedValue(
      "文字起こしには macOS 26 以降が要ります",
    );
    const given = input();
    const { result } = renderHook(() => useTranscribe(given));
    await act(() => result.current.start());
    expect(mocked.pickFile).not.toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenCalledWith(
      "文字起こしには macOS 26 以降が要ります",
    );
  });

  test("test_アシスタントが使えなければ文字起こしだけのノートを作る", async () => {
    mocked.llmAvailable.mockResolvedValue(false);
    const given = input();
    const { result } = renderHook(() => useTranscribe(given));
    await act(() => result.current.start());
    expect(mocked.minutesMake).not.toHaveBeenCalled();
    expect(mocked.writeNote.mock.calls[0][2]).toContain(
      "議事録は作っていません",
    );
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("文字起こしだけ"),
    );
  });

  test("test_アシスタントを切っていれば議事録を頼まない", async () => {
    const { result } = renderHook(() =>
      useTranscribe(
        input({ settings: { ...DEFAULT_SETTINGS, assistantEnabled: false } }),
      ),
    );
    await act(() => result.current.start());
    expect(mocked.llmAvailable).not.toHaveBeenCalled();
    expect(mocked.minutesMake).not.toHaveBeenCalled();
  });

  test("test_議事録が失敗しても文字起こしのノートは作る", async () => {
    mocked.minutesMake.mockRejectedValue("Ollama が止まった");
    const given = input();
    const { result } = renderHook(() => useTranscribe(given));
    await act(() => result.current.start());
    expect(mocked.writeNote).toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("Ollama が止まった"),
    );
  });

  test("test_文字起こしが失敗したらノートを作らず理由を言う", async () => {
    mocked.transcribeFile.mockRejectedValue("文字起こしを止めました");
    const given = input();
    const { result } = renderHook(() => useTranscribe(given));
    await act(() => result.current.start());
    expect(mocked.createNote).not.toHaveBeenCalled();
    expect(mocked.attachmentCopy).not.toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenLastCalledWith("文字起こしを止めました");
    expect(result.current.progress).toBeNull();
  });

  test("test_止めると文字起こしも議事録も止める", async () => {
    const { result } = renderHook(() => useTranscribe(input()));
    await act(() => result.current.stop());
    expect(mocked.transcribeStop).toHaveBeenCalled();
    expect(mocked.llmStop).toHaveBeenCalled();
  });
});
