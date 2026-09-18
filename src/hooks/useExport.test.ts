// @vitest-environment jsdom
// 書き出し・印刷・取り込みの hook（19-4 で App.tsx から切り出した）。Tauri は
// lib/ipc を差し替え、保存先を選ばなければ何も書かない・HTML には本文が入る・
// 取り込みを選ばなければ読まない、を見る

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  readNote: vi.fn(),
  exportWrite: vi.fn(),
  exportWriteBinary: vi.fn(),
  importRead: vi.fn(),
  pdfPageCount: vi.fn(),
  printPage: vi.fn(),
  pickFile: vi.fn(),
  saveTo: vi.fn(),
  createNote: vi.fn(),
  writeNote: vi.fn(),
  imageSource: vi.fn(),
  ocrImage: vi.fn(),
  ocrPdfPage: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { DEFAULT_PPTX_SETTINGS } from "../lib/pptx-settings";
import { useExport, type ExportInput } from "./useExport";

const mocked = vi.mocked(ipc);

function input(over: Partial<ExportInput> = {}): ExportInput {
  return {
    vaultRoot: "/v",
    currentPath: "/v/題.md",
    settings: DEFAULT_SETTINGS,
    pptxSettings: DEFAULT_PPTX_SETTINGS,
    diagramTheme: "light",
    flush: vi.fn(async () => {}),
    resolveEmbeds: vi.fn(async () => new Map()),
    onStatus: vi.fn(),
    refreshLists: vi.fn(async () => {}),
    openNote: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.readNote.mockResolvedValue("# 題\n\n本文です\n");
  mocked.exportWrite.mockResolvedValue(undefined);
  mocked.printPage.mockResolvedValue(undefined);
});

describe("useExport", () => {
  test("test_HTML_の書き出し_保存先を選べば本文の入った_HTML_を書く", async () => {
    mocked.saveTo.mockResolvedValue("/out/題.html");
    const given = input();
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleExport());
    expect(given.flush).toHaveBeenCalled(); // 保存前の本文を書き出さない
    expect(mocked.saveTo).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "題.html" }),
    );
    const [path, html] = mocked.exportWrite.mock.calls[0];
    expect(path).toBe("/out/題.html");
    expect(html).toContain("本文です");
    expect(given.onStatus).toHaveBeenCalledWith("書き出しました: /out/題.html");
  });

  test("test_保存先を選ばなければ何も書かない", async () => {
    mocked.saveTo.mockResolvedValue(null);
    const { result } = renderHook(() => useExport(input()));
    await act(() => result.current.handleExport());
    expect(mocked.exportWrite).not.toHaveBeenCalled();
  });

  test("test_ノートを開いていなければ書き出さない", async () => {
    const { result } = renderHook(() =>
      useExport(input({ currentPath: null })),
    );
    await act(() => result.current.handleExport());
    expect(mocked.saveTo).not.toHaveBeenCalled();
  });

  test("test_印刷は組んだ本文を持ち_開き直すと捨てる", async () => {
    const { result } = renderHook(() => useExport(input()));
    await act(() => result.current.handlePrint());
    await waitFor(() =>
      expect(result.current.printBody?.html).toContain("本文です"),
    );
    act(() => result.current.discardPrintBody());
    expect(result.current.printBody).toBeNull();
  });

  test("test_取り込みはファイルを選ばなければ読まない", async () => {
    mocked.pickFile.mockResolvedValue(null);
    const { result } = renderHook(() => useExport(input()));
    await act(() => result.current.handleImport("pdf"));
    expect(mocked.importRead).not.toHaveBeenCalled();
  });
});
