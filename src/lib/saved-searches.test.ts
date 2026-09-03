// 保存した検索（TASKS 3-17 / K-4）。

import { describe, expect, it } from "vitest";
import {
  loadSearches,
  saveSearches,
  SEARCHES_KEY,
  upsertSearch,
  removeSearch,
} from "./saved-searches";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe("loadSearches", () => {
  it("test_記憶が無ければ空", () => {
    expect(loadSearches(fakeStorage())).toEqual([]);
  });

  it("test_保存した並びを読み戻す", () => {
    const storage = fakeStorage();
    const entries = [
      { name: "今週の仕事", query: "#仕事 after:2026-09-01" },
      { name: "日報", query: "#日報" },
    ];
    saveSearches(storage, entries);
    expect(loadSearches(storage)).toEqual(entries);
  });

  it("test_壊れた値は空へ戻す", () => {
    // 設定は手で編集できる。読めない値でアプリを止めない
    expect(loadSearches(fakeStorage({ [SEARCHES_KEY]: "{ではない" }))).toEqual(
      [],
    );
    expect(loadSearches(fakeStorage({ [SEARCHES_KEY]: '{"a":1}' }))).toEqual(
      [],
    );
  });

  it("test_名前か式が欠けている項目は捨てる", () => {
    const storage = fakeStorage({
      [SEARCHES_KEY]:
        '[{"name":"良い","query":"#仕事"},{"name":""},{"query":"#だけ"},"文字列"]',
    });
    expect(loadSearches(storage)).toEqual([{ name: "良い", query: "#仕事" }]);
  });
});

describe("upsertSearch", () => {
  it("test_足すと末尾に付く", () => {
    const found = upsertSearch([{ name: "日報", query: "#日報" }], {
      name: "会議",
      query: "#会議",
    });
    expect(found.map((entry) => entry.name)).toEqual(["日報", "会議"]);
  });

  it("test_同じ名前は上書きする（式の更新に使う）", () => {
    const found = upsertSearch([{ name: "日報", query: "#日報" }], {
      name: "日報",
      query: "#日報 after:2026-09-01",
    });
    expect(found).toEqual([{ name: "日報", query: "#日報 after:2026-09-01" }]);
  });
});

describe("removeSearch", () => {
  it("test_名前で外す", () => {
    const entries = [
      { name: "日報", query: "#日報" },
      { name: "会議", query: "#会議" },
    ];
    expect(removeSearch(entries, "日報")).toEqual([
      { name: "会議", query: "#会議" },
    ]);
  });
});
