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

// 画像の描き直しは WebView の canvas が要るので、呼ばれたかだけを見る
vi.mock("../lib/svg-png", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/svg-png")>()),
  rasterizeForPptx: vi.fn(async (url: string | null) => url),
}));

import * as ipc from "../lib/ipc";
import * as svgPng from "../lib/svg-png";
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
    defaultFolder: () => "",
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

  test("test_Qiita_用_Markdown_を_qiita-cli_の形で書き出す（要望_2026-10-05）", async () => {
    mocked.readNote.mockResolvedValue(
      "---\nqiita: abc123\n---\n# 題\n\n本文です。\n\n#Rust\n",
    );
    mocked.saveTo.mockResolvedValue("/out/題.md");
    const given = input();
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleExportQiita());
    expect(given.flush).toHaveBeenCalled();
    expect(mocked.saveTo).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "題.md" }),
    );
    const [path, file] = mocked.exportWrite.mock.calls[0];
    expect(path).toBe("/out/題.md");
    expect(file).toContain('title: "題"');
    expect(file).toContain('  - "Rust"');
    expect(file).toContain('id: "abc123"');
    expect(file).toContain("---\n本文です。\n");
    expect(file).not.toContain("#Rust");
    expect(given.onStatus).toHaveBeenCalledWith(
      expect.stringContaining("書き出しました: /out/題.md"),
    );
  });

  test("test_Qiita_用_Markdown_は載らない画像とタグの無さを知らせる", async () => {
    mocked.readNote.mockResolvedValue("# 題\n\n![図](attachments/a.png)\n");
    mocked.saveTo.mockResolvedValue("/out/題.md");
    const given = input();
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleExportQiita());
    const calls = vi.mocked(given.onStatus).mock.calls;
    const said = calls[calls.length - 1]?.[0] ?? "";
    expect(said).toContain("1 枚の画像は Qiita に載りません");
    expect(said).toContain("タグ");
  });

  test("test_施錠したノートは書き出さない（平文のファイルを作らない。ADR-0062）", async () => {
    const given = input({ currentPath: "/v/秘密.md.enc" });
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleExport());
    await act(() => result.current.handleExportDocx());
    await act(() => result.current.handleExportPptx());
    await act(() => result.current.handleExportQiita());
    await act(() => result.current.handlePrint(true));
    expect(mocked.readNote).not.toHaveBeenCalled();
    expect(mocked.saveTo).not.toHaveBeenCalled();
    expect(given.onStatus).toHaveBeenCalledWith(
      "施錠したノートは書き出せません",
    );
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

  test("test_取り込んだノートは選んでいるフォルダに作る（要望 2026-10-01）", async () => {
    // 新しいノート（Cmd+N）と同じ。以前は選んでいても保管フォルダの直下に作った
    mocked.pickFile.mockResolvedValue("/in/板書.png");
    mocked.importRead.mockResolvedValue("AA==");
    mocked.ocrImage.mockResolvedValue("読み取った字");
    mocked.createNote.mockResolvedValue("/v/仕事/板書.md");
    mocked.writeNote.mockResolvedValue(undefined);
    const given = input({ defaultFolder: () => "仕事" });
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleImport("image"));
    expect(mocked.createNote).toHaveBeenCalledWith("/v", "板書", "仕事");
    expect(given.openNote).toHaveBeenCalledWith("/v/仕事/板書.md");
  });

  test("test_PowerPoint_の絵は_PowerPoint_向けの描き直しを通す（向きの印。レビュー 2026-09-28）", async () => {
    mocked.readNote.mockResolvedValue("## 題\n\n![写真](写真.jpg)\n");
    mocked.saveTo.mockResolvedValue("/out/題.pptx");
    mocked.imageSource.mockResolvedValue("data:image/jpeg;base64,AA==");
    mocked.exportWriteBinary.mockResolvedValue(undefined);
    const given = input();
    const { result } = renderHook(() => useExport(given));
    await act(() => result.current.handleExportPptx());
    expect(vi.mocked(svgPng.rasterizeForPptx)).toHaveBeenCalledWith(
      "data:image/jpeg;base64,AA==",
    );
    expect(mocked.exportWriteBinary).toHaveBeenCalled();
  });
});
