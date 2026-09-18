// Tauri コマンドの薄い包み（lib/ipc）の検証。invoke は差し替えて、
// 渡す形（コマンド名・引数・base64）と、Rust を呼ばずに済ませる判断を見る。

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(unlisten)),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as pluginOpen } from "@tauri-apps/plugin-dialog";
import {
  defaultVault,
  exportWrite,
  exportWriteBinary,
  importRead,
  openHandoffApp,
  openHandoffUrl,
  openInFinder,
  pdfPageCount,
  pickFile,
  pickFolder,
  printPage,
  startupElapsedMs,
  appendDaily,
  clearRecovery,
  conflictCopy,
  createFolder,
  createFromTemplate,
  createNote,
  dailyNote,
  deleteFolder,
  deleteForever,
  discardStash,
  duplicateNote,
  emptyTrash,
  fetchLists,
  historyList,
  historyRead,
  historyRestore,
  historyUsage,
  imageSource,
  linkMap,
  llmAvailable,
  llmGenerate,
  llmLoaded,
  llmModels,
  llmStop,
  llmUnload,
  mcpConfig,
  mcpHidden,
  moveFolder,
  moveNote,
  noteBacklinks,
  noteExists,
  noteRelated,
  notesInFolder,
  notesWithTag,
  ocrImage,
  ocrPdfPage,
  openVaultRoot,
  pendingRecovery,
  pinNote,
  placeManual,
  placeMcpManual,
  readNote,
  registerTemplate,
  renameFolder,
  renameNote,
  renameTag,
  replaceApply,
  replacePreview,
  restoreNote,
  restoreRecovery,
  saveAttachment,
  searchNotes,
  setMcpHidden,
  setMenuChecks,
  stashNote,
  subscribeLlm,
  subscribeVaultChanged,
  syncIndex,
  taskComplete,
  templateList,
  toEntry,
  trashAttachments,
  trashNote,
  unusedAttachments,
  vaultIsEmpty,
  writeNote,
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

  test("test_読めなかった結果は覚えない（あとで画像を置けば描かれる）", async () => {
    // 失敗まで永久に覚えると、参照切れの画像を後から置いても再起動まで
    // 描かれなかった（棚卸し 2026-09-17）
    invoked.mockRejectedValueOnce(new Error("no file"));
    expect(await imageSource("/v", "attachments/later.png")).toBeNull();
    invoked.mockResolvedValue("data:image/png;base64,QUJD");
    expect(await imageSource("/v", "attachments/later.png")).toBe(
      "data:image/png;base64,QUJD",
    );
    expect(invoked).toHaveBeenCalledTimes(2);
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
      request: {
        port: 1,
        model: "m",
        context: 8192,
        timeoutMinutes: 6,
        keepAlive: "5m",
        task: "summary",
        title: "題",
        body: "本文",
      },
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

describe("MCP の設定断片", () => {
  test("test_保管フォルダを渡して_貼る JSON を受け取る", async () => {
    invoked.mockResolvedValue('{"mcpServers":{}}');
    expect(await mcpConfig("/v")).toBe('{"mcpServers":{}}');
    expect(invoked).toHaveBeenCalledWith("mcp_config", { root: "/v" });
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

// ---- 包み 47 個の「コマンド名と引数の形」をまとめて固定する（棚卸し 2026-09-17）。
// 綴りを変えると Rust 側の `generate_handler!` と噛み合わなくなる。ここが赤に
// なることで気付く（TS↔Rust の名前の一致は lib.rs 側の登録と一対一）
describe("包みのコマンド名と引数（表）", () => {
  const ROW: [
    string,
    () => Promise<unknown>,
    string,
    Record<string, unknown>,
  ][] = [
    [
      "taskComplete",
      () => taskComplete("/v", "a.md", 3),
      "task_complete",
      { root: "/v", path: "a.md", line: 3 },
    ],
    [
      "openVaultRoot",
      () => openVaultRoot("/v", 30),
      "vault_open",
      { root: "/v", trashDays: 30 },
    ],
    [
      "openVaultRoot（日数なし）",
      () => openVaultRoot("/v"),
      "vault_open",
      { root: "/v", trashDays: undefined },
    ],
    [
      "vaultIsEmpty",
      () => vaultIsEmpty("/v"),
      "vault_is_empty",
      { root: "/v" },
    ],
    [
      "noteExists",
      () => noteExists("/v", "/v/a.md"),
      "note_exists",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "readNote",
      () => readNote("/v", "/v/a.md"),
      "note_read",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "writeNote",
      () => writeNote("/v", "/v/a.md", "本文", 60),
      "note_write",
      { root: "/v", path: "/v/a.md", text: "本文", historyMinutes: 60 },
    ],
    [
      "createNote",
      () => createNote("/v", "題", "仕事"),
      "note_create",
      { root: "/v", title: "題", folder: "仕事" },
    ],
    [
      "renameNote",
      () => renameNote("/v", "/v/a.md", "新"),
      "note_rename",
      { root: "/v", path: "/v/a.md", title: "新" },
    ],
    [
      "trashNote",
      () => trashNote("/v", "/v/a.md"),
      "note_trash",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "restoreNote",
      () => restoreNote("/v", "/v/.trash/a.md"),
      "note_restore",
      { root: "/v", path: "/v/.trash/a.md" },
    ],
    [
      "pinNote",
      () => pinNote("/v", "/v/a.md", true),
      "note_pin",
      { root: "/v", path: "/v/a.md", pinned: true },
    ],
    [
      "deleteForever",
      () => deleteForever("/v", "/v/.trash/a.md"),
      "trash_delete",
      { root: "/v", path: "/v/.trash/a.md" },
    ],
    ["emptyTrash", () => emptyTrash("/v"), "trash_empty", { root: "/v" }],
    // 書き出し・取り込み・OS（19-4 で App.tsx から寄せた 10 本）
    [
      "exportWrite",
      () => exportWrite("/out.html", "<p>x</p>"),
      "export_write",
      { path: "/out.html", text: "<p>x</p>" },
    ],
    [
      "exportWriteBinary",
      () => exportWriteBinary("/out.docx", "AAAA"),
      "export_write_binary",
      { path: "/out.docx", data: "AAAA" },
    ],
    [
      "importRead",
      () => importRead("/in.pdf"),
      "import_read",
      { path: "/in.pdf" },
    ],
    [
      "pdfPageCount",
      () => pdfPageCount("AAAA"),
      "pdf_page_count",
      { data: "AAAA" },
    ],
    ["printPage", () => printPage(), "print_page", {}],
    ["defaultVault", () => defaultVault(), "default_vault", {}],
    [
      "openInFinder",
      () => openInFinder("/v", "/v/仕事"),
      "open_in_finder",
      { root: "/v", path: "/v/仕事" },
    ],
    [
      "openHandoffUrl",
      () => openHandoffUrl("dict://語"),
      "open_handoff_url",
      { url: "dict://語" },
    ],
    [
      "openHandoffApp",
      () => openHandoffApp("Notes"),
      "open_handoff_app",
      { app: "Notes" },
    ],
    ["startupElapsedMs", () => startupElapsedMs(), "startup_elapsed_ms", {}],
    ["templateList", () => templateList("/v"), "template_list", { root: "/v" }],
    [
      "createFromTemplate（題は雛形の名前 = 空を送る）",
      () => createFromTemplate("/v", "議事録"),
      "note_create_from_template",
      { root: "/v", template: "議事録", title: "" },
    ],
    [
      "dailyNote",
      () => dailyNote("/v", "2026-09-17"),
      "note_daily",
      { root: "/v", day: "2026-09-17" },
    ],
    ["placeManual", () => placeManual("/v"), "manual_place", { root: "/v" }],
    [
      "setMenuChecks",
      () =>
        setMenuChecks({
          "toggle-trees": true,
          "toggle-notes": false,
          outline: false,
          assistant: false,
          "inline-mode": true,
          "source-mode": false,
          "preview-mode": false,
          "focus-mode": false,
          typewriter: false,
        }),
      "menu_checks",
      { state: expect.objectContaining({ "inline-mode": true }) },
    ],
    [
      "placeMcpManual",
      () => placeMcpManual("/v"),
      "mcp_manual_place",
      { root: "/v" },
    ],
    [
      "createFolder",
      () => createFolder("/v", "仕事/新"),
      "folder_create",
      { root: "/v", folder: "仕事/新" },
    ],
    [
      "moveFolder",
      () => moveFolder("/v", "仕事", "古い"),
      "folder_move",
      { root: "/v", folder: "仕事", into: "古い" },
    ],
    [
      "renameFolder",
      () => renameFolder("/v", "仕事", "仕事2"),
      "folder_rename",
      { root: "/v", folder: "仕事", name: "仕事2" },
    ],
    [
      "deleteFolder",
      () => deleteFolder("/v", "仕事"),
      "folder_delete",
      { root: "/v", folder: "仕事" },
    ],
    [
      "moveNote",
      () => moveNote("/v", "/v/a.md", "仕事"),
      "note_move",
      { root: "/v", path: "/v/a.md", folder: "仕事" },
    ],
    [
      "noteBacklinks",
      () => noteBacklinks("/v", "題"),
      "note_backlinks",
      { root: "/v", title: "題" },
    ],
    [
      "stashNote",
      () => stashNote("/v", "/v/a.md", "途中"),
      "recovery_stash",
      { root: "/v", path: "/v/a.md", text: "途中" },
    ],
    [
      "discardStash",
      () => discardStash("/v", "/v/a.md"),
      "recovery_discard",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "pendingRecovery",
      () => pendingRecovery("/v"),
      "recovery_pending",
      { root: "/v" },
    ],
    [
      "restoreRecovery",
      () => restoreRecovery("/v"),
      "recovery_restore",
      { root: "/v" },
    ],
    [
      "clearRecovery",
      () => clearRecovery("/v"),
      "recovery_clear",
      { root: "/v" },
    ],
    [
      "syncIndex",
      () => syncIndex("/v", true),
      "index_sync",
      { root: "/v", full: true },
    ],
    [
      "duplicateNote",
      () => duplicateNote("/v", "/v/a.md"),
      "note_duplicate",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "registerTemplate",
      () => registerTemplate("/v", "/v/a.md", "雛形"),
      "template_register",
      { root: "/v", path: "/v/a.md", name: "雛形" },
    ],
    [
      "unusedAttachments",
      () => unusedAttachments("/v"),
      "attachments_unused",
      { root: "/v" },
    ],
    [
      "trashAttachments",
      () => trashAttachments("/v", ["/v/attachments/a.png"]),
      "attachments_trash",
      { root: "/v", paths: ["/v/attachments/a.png"] },
    ],
    [
      "noteRelated",
      () => noteRelated("/v", "/v/a.md", "題"),
      "note_related",
      { root: "/v", path: "/v/a.md", title: "題" },
    ],
    ["linkMap", () => linkMap("/v"), "link_map", { root: "/v" }],
    [
      "searchNotes",
      () => searchNotes("/v", "会議 #仕事"),
      "note_search",
      { root: "/v", query: "会議 #仕事" },
    ],
    [
      "conflictCopy",
      () => conflictCopy("/v", "/v/a.md", "自分の版"),
      "conflict_copy",
      { root: "/v", path: "/v/a.md", text: "自分の版" },
    ],
    [
      "historyList",
      () => historyList("/v", "/v/a.md"),
      "history_list",
      { root: "/v", path: "/v/a.md" },
    ],
    [
      "historyRead",
      () => historyRead("/v", "/v/a.md", "/v/.OboeGaki/history/x/y.md"),
      "history_read",
      { root: "/v", path: "/v/a.md", version: "/v/.OboeGaki/history/x/y.md" },
    ],
    [
      "historyRestore",
      () => historyRestore("/v", "/v/a.md", "/v/.OboeGaki/history/x/y.md"),
      "history_restore",
      { root: "/v", path: "/v/a.md", version: "/v/.OboeGaki/history/x/y.md" },
    ],
    [
      "replacePreview（options を平らに）",
      () =>
        replacePreview("/v", "a", { caseSensitive: true, includeCode: false }),
      "replace_preview",
      { root: "/v", from: "a", caseSensitive: true, includeCode: false },
    ],
    [
      "replaceApply（options を平らに）",
      () =>
        replaceApply("/v", "a", "b", {
          caseSensitive: false,
          includeCode: true,
        }),
      "replace_apply",
      {
        root: "/v",
        from: "a",
        to: "b",
        caseSensitive: false,
        includeCode: true,
      },
    ],
    [
      "renameTag",
      () => renameTag("/v", "旧", "新"),
      "tag_rename",
      { root: "/v", from: "旧", to: "新" },
    ],
    [
      "appendDaily",
      () => appendDaily("/v", "思いつき"),
      "note_append_daily",
      { root: "/v", text: "思いつき" },
    ],
  ];

  test.each(ROW)("%s", async (_name, call, command, args) => {
    invoked.mockResolvedValue(undefined);
    await call();
    expect(invoked).toHaveBeenCalledWith(command, args);
  });

  test("test_fetchLists は 5 つを引いて camelCase に組み替える", async () => {
    invoked.mockImplementation(async (command: string) => {
      switch (command) {
        case "note_list":
          return [];
        case "tag_list":
          return [["仕事", 2]];
        case "folder_list":
          return [["箱", 1]];
        case "trash_list":
          return [{ path: "/v/.trash/a.md", trashed_ms: 5 }];
        case "task_list":
          return [
            { path: "a.md", line: 0, text: "やる", due: null, mtime_ms: 1 },
          ];
        default:
          throw new Error(`知らない: ${command}`);
      }
    });
    const lists = await fetchLists("/v");
    expect(lists.tags).toEqual([{ tag: "仕事", count: 2 }]);
    expect(lists.folders).toEqual([{ folder: "箱", count: 1 }]);
    expect(lists.trashNotes).toEqual([
      { path: "/v/.trash/a.md", trashedMs: 5 },
    ]);
    expect(lists.tasks).toHaveLength(1);
    for (const command of [
      "note_list",
      "tag_list",
      "folder_list",
      "trash_list",
      "task_list",
    ]) {
      expect(invoked).toHaveBeenCalledWith(command, { root: "/v" });
    }
  });

  test("test_notesWithTag と notesInFolder は toEntry で一覧の形にする", async () => {
    invoked.mockResolvedValue([
      { path: "a.md", title: "a", preview: "", mtime_ns: 0, pinned: false },
    ]);
    const byTag = await notesWithTag("/v", "仕事");
    expect(invoked).toHaveBeenCalledWith("notes_with_tag", {
      root: "/v",
      tag: "仕事",
    });
    expect(byTag[0].path).toBe("/v/a.md");
    const inFolder = await notesInFolder("/v", "箱");
    expect(invoked).toHaveBeenCalledWith("notes_in_folder", {
      root: "/v",
      folder: "箱",
    });
    expect(inFolder[0].path).toBe("/v/a.md");
  });

  test("test_subscribeLlm は 3 本を張って_返り値で 3 本とも外す", () => {
    const stop = subscribeLlm({
      onChunk: () => {},
      onDone: () => {},
      onFailed: () => {},
    });
    expect(vi.mocked(listen).mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["llm-chunk", "llm-done", "llm-failed"]),
    );
    stop();
  });
});

// ---- OS の窓の包み（19-4）。選ばなかった／複数が返った形は null に揃える
describe("OS の窓の包み", () => {
  const opened = vi.mocked(pluginOpen);
  beforeEach(() => opened.mockReset());

  test("test_pickFile_は_1_つだけ選ばせ_選ばなければ_null", async () => {
    opened.mockResolvedValueOnce("/a.pdf");
    expect(
      await pickFile({ filters: [{ name: "PDF", extensions: ["pdf"] }] }),
    ).toBe("/a.pdf");
    expect(opened).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    opened.mockResolvedValueOnce(null);
    expect(await pickFile({})).toBeNull();
  });

  test("test_pickFolder_はフォルダを選ばせる", async () => {
    opened.mockResolvedValueOnce("/v");
    expect(await pickFolder()).toBe("/v");
    expect(opened).toHaveBeenCalledWith({ directory: true });
  });
});
