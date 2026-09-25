// @vitest-environment jsdom
// アシスタント（Ollama）の状態と処理（ADR-0049 / L-1〜L-3 / ADR-0025）の検証。
// Rust への包み（lib/ipc）を差し替え、hook の判断だけを見る。

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  llmAvailable: vi.fn(),
  llmGenerate: vi.fn(),
  llmStop: vi.fn(),
  llmLoaded: vi.fn(),
  llmUnload: vi.fn(),
  subscribeLlm: vi.fn(),
  noteRelated: vi.fn(),
  searchNotes: vi.fn(),
  readNote: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { LOADING_NOTICE } from "../lib/assistant-text";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { useAssistant, type AssistantInput } from "./useAssistant";

const mocked = vi.mocked(ipc);
type LlmHandlers = Parameters<typeof ipc.subscribeLlm>[0];
let handlers: LlmHandlers | null = null;

function input(over: Partial<AssistantInput> = {}): AssistantInput {
  return {
    open: true,
    vaultRoot: "/v",
    currentPath: "/v/会議.md",
    notes: [],
    settings: { ...DEFAULT_SETTINGS, assistantEnabled: true, llmPort: 11434 },
    flushEdits: vi.fn(() => Promise.resolve()),
    noteText: () => "本文です",
    onStatus: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  handlers = null;
  mocked.subscribeLlm.mockImplementation((given) => {
    handlers = given;
    return () => {
      handlers = null;
    };
  });
  mocked.llmAvailable.mockResolvedValue(true);
  mocked.llmGenerate.mockResolvedValue(true);
  mocked.llmLoaded.mockResolvedValue(true);
  mocked.llmStop.mockResolvedValue(undefined);
  mocked.noteRelated.mockResolvedValue([]);
});

describe("useAssistant", () => {
  test("test_開いたときだけ Ollama が動いているか確かめる", async () => {
    const { result, rerender } = renderHook(
      (given: AssistantInput) => useAssistant(given),
      {
        initialProps: input({ open: false }),
      },
    );
    expect(mocked.llmAvailable).not.toHaveBeenCalled();
    expect(result.current.llmReady).toBeNull();
    rerender(input({ open: true }));
    await waitFor(() => expect(result.current.llmReady).toBe(true));
    expect(mocked.llmAvailable).toHaveBeenCalledWith(11434);
  });

  test("test_流れてきたぶんから順に出し_終わったら考え中を解く", async () => {
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    expect(handlers).not.toBeNull();
    act(() => handlers!.onChunk("要点は"));
    act(() => handlers!.onChunk("3 つ"));
    expect(result.current.answer).toBe("要点は3 つ");
    act(() => handlers!.onDone());
    expect(result.current.thinking).toBe(false);
  });

  test("test_ノートを替えたら前の答えは消す（21-4）", async () => {
    const { result, rerender } = renderHook(
      (props: AssistantInput) => useAssistant(props),
      { initialProps: input() },
    );
    await act(() => result.current.ask("summary"));
    act(() => handlers?.onChunk("要点"));
    expect(result.current.answer).toBe("要点");
    rerender(input({ currentPath: "/v/別.md" }));
    expect(result.current.answer).toBe("");
    // 生成も止め、あとから届いた続きは捨てる（21-5）
    expect(mocked.llmStop).toHaveBeenCalled();
    expect(result.current.thinking).toBe(false);
    act(() => handlers?.onChunk("の続き"));
    expect(result.current.answer).toBe("");
    // 新しいノートで頼んでも、まだ前の生成が止まり切っていない（started=false）
    // 間は続きを受けない（21-6）
    mocked.llmGenerate.mockResolvedValue(false);
    await act(() => result.current.ask("summary"));
    act(() => handlers?.onChunk("前のノートの続き"));
    expect(result.current.answer).not.toContain("前のノートの続き");
  });

  test("test_頼んでいる往復の間にノートを替えたら_遅れて始まっても続きを受けない（21-7）", async () => {
    let start: (ok: boolean) => void = () => {};
    mocked.llmGenerate.mockImplementation(
      () => new Promise<boolean>((resolve) => (start = resolve)),
    );
    const { result, rerender } = renderHook(
      (props: AssistantInput) => useAssistant(props),
      { initialProps: input() },
    );
    const asking = result.current.ask("summary");
    // llmGenerate が呼ばれる（= 往復の最中）まで進めてからノートを替える
    await act(async () => {
      await vi.waitFor(() => expect(mocked.llmGenerate).toHaveBeenCalled());
    });
    rerender(input({ currentPath: "/v/別.md" }));
    await act(async () => {
      start(true);
      await asking;
    });
    act(() => handlers?.onChunk("A の要約"));
    expect(result.current.answer).toBe("");
  });

  test("test_失敗は読める言葉にして答えの場所に出す", async () => {
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    act(() => handlers!.onFailed("timeout"));
    expect(result.current.thinking).toBe(false);
    expect(result.current.answer).not.toBe("");
    expect(result.current.answer).not.toBe("timeout");
  });

  test("test_要約は打ちかけを書き切ってから本文を渡す", async () => {
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    await act(() => result.current.ask("summary"));
    expect(given.flushEdits).toHaveBeenCalledTimes(1);
    expect(mocked.llmGenerate).toHaveBeenCalledWith(given.settings, {
      task: "summary",
      title: "会議",
      body: "本文です",
    });
    expect(result.current.thinking).toBe(true);
  });

  test("test_モデルが載っていなければ読み込み中と出す", async () => {
    const given = input();
    mocked.llmLoaded.mockResolvedValue(false);
    const { result } = renderHook(() => useAssistant(given));
    await act(() => result.current.ask("review"));
    expect(result.current.answer).toBe(LOADING_NOTICE);
  });

  test("test_始められなければ考え中を解いて断る", async () => {
    const given = input();
    mocked.llmGenerate.mockResolvedValue(false);
    const { result } = renderHook(() => useAssistant(given));
    await act(() => result.current.ask("summary"));
    expect(result.current.thinking).toBe(false);
    expect(result.current.answer).toMatch(/いま考えています/);
  });

  test("test_ノートを開いていなければ何もしない", async () => {
    const { result } = renderHook(() =>
      useAssistant(input({ currentPath: null })),
    );
    await act(() => result.current.ask("summary"));
    expect(mocked.llmGenerate).not.toHaveBeenCalled();
  });

  test("test_質問は索引で材料を選び_出典を答えより先に出す（L-2）", async () => {
    mocked.searchNotes.mockResolvedValue({
      hits: [{ path: "予算.md", title: "予算", snippet: "" }],
      unreadable: [],
    });
    mocked.readNote.mockResolvedValue("予算の本文");
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    act(() => result.current.setQuestion("予算はいくら？"));
    await act(() => result.current.askQuestion());
    expect(mocked.readNote).toHaveBeenCalledWith("/v", "/v/予算.md");
    expect(result.current.sources).toEqual([
      { path: "予算.md", title: "予算", snippet: "" },
    ]);
    expect(mocked.llmGenerate).toHaveBeenCalledWith(
      given.settings,
      expect.objectContaining({
        task: "question",
        question: "予算はいくら？",
        sources: expect.arrayContaining([["予算", "予算の本文"]]),
      }),
    );
    expect(result.current.thinking).toBe(true);
  });

  test("test_材料の無い問いには答えさせない", async () => {
    const given = input();
    mocked.searchNotes.mockResolvedValue({ hits: [], unreadable: [] });
    const { result } = renderHook(() => useAssistant(given));
    act(() => result.current.setQuestion("宇宙の果て"));
    await act(() => result.current.askQuestion());
    expect(mocked.llmGenerate).not.toHaveBeenCalled();
    expect(result.current.answer).toMatch(/材料になるノートが見つかりません/);
  });

  test("test_空の質問は送らない", async () => {
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    act(() => result.current.setQuestion("   "));
    await act(() => result.current.askQuestion());
    expect(mocked.searchNotes).not.toHaveBeenCalled();
  });

  test("test_関連は索引から引き_別のノートへ移ると畳む（L-3）", async () => {
    mocked.noteRelated.mockResolvedValue([
      { path: "計画.md", title: "計画", reasons: ["同じタグ"], score: 1 },
    ]);
    const { result, rerender } = renderHook(
      (given: AssistantInput) => useAssistant(given),
      {
        initialProps: input(),
      },
    );
    act(() => result.current.showRelated());
    expect(result.current.relatedShown).toBe(true);
    await waitFor(() => expect(result.current.related).toHaveLength(1));
    expect(mocked.noteRelated).toHaveBeenCalledWith("/v", "/v/会議.md", "会議");
    rerender(input({ currentPath: "/v/別.md" }));
    expect(result.current.relatedShown).toBe(false);
    expect(result.current.sources).toEqual([]);
  });

  test("test_止めるは受け取ったぶんを消さない", async () => {
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    act(() => handlers!.onChunk("途中まで"));
    act(() => result.current.stop());
    expect(mocked.llmStop).toHaveBeenCalledTimes(1);
    expect(result.current.answer).toBe("途中まで");
  });

  test("test_モデルを降ろす_切ってあれば触りに行かない", async () => {
    const off = input({
      settings: { ...DEFAULT_SETTINGS, assistantEnabled: false },
    });
    const { result } = renderHook(() => useAssistant(off));
    await act(() => result.current.unloadModel());
    expect(mocked.llmUnload).not.toHaveBeenCalled();
    expect(off.onStatus).toHaveBeenCalledWith(
      "アシスタントは環境設定で切ってあります",
    );
  });

  test("test_モデルを降ろす_結果を知らせる", async () => {
    mocked.llmUnload.mockResolvedValue(true);
    const given = input();
    const { result } = renderHook(() => useAssistant(given));
    await act(() => result.current.unloadModel());
    expect(given.onStatus).toHaveBeenCalledWith("モデルを降ろしました");
  });
});
