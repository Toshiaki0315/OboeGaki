// @vitest-environment jsdom
// 覗き見の泡（U-2）の出す・待つ・隠す。DOM を触るので jsdom。純関数の
// `peekExcerpt` は note-peek.test.ts で見ている（レビュー 2026-09-14 / 15-13）。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { embedResolver } from "./embed";
import { NotePeek, PEEK_DELAY_MS } from "./note-peek";

/// 泡が要るのは `state.facet(embedResolver)` と `dom` だけ。本物の
/// EditorView を組まずに、その 2 つだけ持つ入れ物で試す
function viewWith(texts: Record<string, string>) {
  const dom = document.createElement("div");
  document.body.appendChild(dom);
  const state = EditorState.create({
    extensions: [
      embedResolver.of({
        resolve: async (name) =>
          name in texts ? { text: texts[name], path: `${name}.md` } : null,
        open: () => {},
      }),
    ],
  });
  return { state, dom } as unknown as EditorView;
}

const bubbleIn = (view: EditorView) => view.dom.querySelector(".cm-note-peek");

describe("NotePeek", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("test_待ってから題名と冒頭を出す", async () => {
    const view = viewWith({ 会議メモ: "# 会議メモ\n\n決めたこと\n" });
    const peek = new NotePeek(view);
    peek.update("会議メモ", { x: 10, y: 20 });
    expect(bubbleIn(view)).toBeNull(); // まだ待っている
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    const bubble = bubbleIn(view);
    expect(bubble?.querySelector(".cm-note-peek-title")?.textContent).toBe(
      "会議メモ",
    );
    expect(bubble?.querySelector(".cm-note-peek-body")?.textContent).toBe(
      "決めたこと",
    );
    peek.destroy();
    expect(bubbleIn(view)).toBeNull();
  });

  test("test_待っている間に隠せば出ない（通り過ぎただけ）", async () => {
    const view = viewWith({ 会議メモ: "# 会議メモ\n\n決めたこと\n" });
    const peek = new NotePeek(view);
    peek.update("会議メモ", { x: 10, y: 20 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS / 2);
    peek.hide();
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    expect(bubbleIn(view)).toBeNull();
  });

  test("test_取り寄せの途中で別の場所へ移れば_遅れて届いた中身は捨てる", async () => {
    // 取り寄せを手で解く門。閉じたまま hide → 開ける、の順で「遅れて届く」を作る
    const gate: { release: (() => void) | null } = { release: null };
    const view = viewWith({});
    const slow = EditorState.create({
      extensions: [
        embedResolver.of({
          resolve: () =>
            new Promise((done) => {
              gate.release = () =>
                done({ text: "# 遅い\n\n遅れて届いた\n", path: "遅い.md" });
            }),
          open: () => {},
        }),
      ],
    });
    (view as unknown as { state: EditorState }).state = slow;
    const peek = new NotePeek(view);
    peek.update("遅い", { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    peek.hide(); // 取り寄せ中に離れた
    gate.release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(bubbleIn(view)).toBeNull();
  });

  test("test_中身が無いノートには泡を出さない", async () => {
    const view = viewWith({ 骨: "# 骨\n" });
    const peek = new NotePeek(view);
    peek.update("骨", { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    expect(bubbleIn(view)).toBeNull();
    peek.update("無い", { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    expect(bubbleIn(view)).toBeNull();
  });

  test("test_同じリンクの上では出し直さない", async () => {
    const view = viewWith({ 会議メモ: "# 会議メモ\n\n決めたこと\n" });
    const peek = new NotePeek(view);
    peek.update("会議メモ", { x: 10, y: 20 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    const first = bubbleIn(view);
    peek.update("会議メモ", { x: 30, y: 20 });
    await vi.advanceTimersByTimeAsync(PEEK_DELAY_MS);
    expect(bubbleIn(view)).toBe(first);
  });
});
