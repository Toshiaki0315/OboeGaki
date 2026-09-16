// 左下のペイン（フォルダ / タグ / やること）の開閉の記憶（レビュー 2026-09-16）。
// 鍵の字面を App.tsx に直書きしていたのを、他の設定と同じくここへ集めた。

import { describe, expect, it } from "vitest";
import {
  rememberSidePane,
  restoreSidePane,
  SIDE_PANE_KEY,
  toggleSidePane,
} from "./side-pane";

function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

describe("restoreSidePane", () => {
  it("test_覚えている種類で始まる", () => {
    expect(restoreSidePane(memory({ [SIDE_PANE_KEY]: "tags" }))).toBe("tags");
    expect(restoreSidePane(memory({ [SIDE_PANE_KEY]: "tasks" }))).toBe("tasks");
  });

  it("test_閉じていたことも覚える（空文字）", () => {
    expect(restoreSidePane(memory({ [SIDE_PANE_KEY]: "" }))).toBeNull();
  });

  it("test_記憶が無い_知らない字_読めないときはフォルダ", () => {
    expect(restoreSidePane(memory())).toBe("folders");
    expect(restoreSidePane(memory({ [SIDE_PANE_KEY]: "hoge" }))).toBe(
      "folders",
    );
    expect(
      restoreSidePane({
        getItem: () => {
          throw new Error("だめ");
        },
      }),
    ).toBe("folders");
  });
});

describe("toggleSidePane / rememberSidePane", () => {
  it("test_同じものを押したら閉じ_違うものなら入れ替わる（排他）", () => {
    expect(toggleSidePane("folders", "folders")).toBeNull();
    expect(toggleSidePane("folders", "tags")).toBe("tags");
    expect(toggleSidePane(null, "tasks")).toBe("tasks");
  });

  it("test_覚える_閉じたときは空文字_書けなくても落ちない", () => {
    const store = memory();
    rememberSidePane(store, "tags");
    expect(store.map.get(SIDE_PANE_KEY)).toBe("tags");
    rememberSidePane(store, null);
    expect(store.map.get(SIDE_PANE_KEY)).toBe("");
    expect(() =>
      rememberSidePane(
        {
          setItem: () => {
            throw new Error("満杯");
          },
        },
        "tags",
      ),
    ).not.toThrow();
  });
});
