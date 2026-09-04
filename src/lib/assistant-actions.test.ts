// アシスタントのボタン（アイコンのみ + Tips。要望 2026-09-04）。

import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTIONS } from "./assistant-actions";

describe("ASSISTANT_ACTIONS", () => {
  it("test_並びは参照実装と同じ", () => {
    expect(ASSISTANT_ACTIONS.map((action) => action.id)).toEqual([
      "summary",
      "review",
      "related",
      "stop",
    ]);
  });

  it("test_同じものを二度置かない", () => {
    const ids = ASSISTANT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("test_すべてに呼び名と説明と絵がある", () => {
    // アイコンだけなので、呼び名と説明が唯一の手掛かり
    for (const action of ASSISTANT_ACTIONS) {
      expect(action.label).not.toBe("");
      expect(action.hint).toContain(action.label);
      expect(action.paths.length).toBeGreaterThan(0);
    }
  });

  it("test_関連はモデルを通さないと説明に書く", () => {
    // Ollama が無くても押せる理由が、押す前に分かるようにする（L-3）
    const related = ASSISTANT_ACTIONS.find((action) => action.id === "related");
    expect(related?.hint).toContain("索引");
  });
});
