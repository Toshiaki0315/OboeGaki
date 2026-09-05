// 選んだ文字を外のサービスへ渡す（要望 2026-09-05）。
//
// **このアプリで初めて、ノートの中身が外へ出る道**。押したときだけ動き、
// 渡すのは選んだところだけ。

import { describe, expect, it } from "vitest";
import {
  confirmMessage,
  HANDOFFS,
  handoffUrl,
  needsConfirm,
  searchUrl,
} from "./handoff";

describe("HANDOFFS", () => {
  it("test_並びは生成AIのあとに検索", () => {
    expect(HANDOFFS.map((entry) => entry.id)).toEqual([
      "claude",
      "gemini",
      "chatgpt",
      "copilot",
      "google",
    ]);
  });

  it("test_渡し先はアプリか URL のどちらか一方", () => {
    for (const entry of HANDOFFS) {
      expect(Boolean(entry.app) !== Boolean(entry.search), entry.id).toBe(true);
    }
  });

  it("test_呼び名に何をするかが書いてある", () => {
    // 「渡す」と「検索」を言い分ける（外へ出ることが分かるように）
    expect(HANDOFFS.find((e) => e.id === "claude")?.label).toBe(
      "Claude に渡す",
    );
    expect(HANDOFFS.find((e) => e.id === "google")?.label).toBe(
      "Google で検索",
    );
  });
});

describe("needsConfirm", () => {
  const claude = HANDOFFS.find((entry) => entry.id === "claude")!;
  const google = HANDOFFS.find((entry) => entry.id === "google")!;

  it("test_設定が入っていれば生成AIの前に確認する", () => {
    expect(needsConfirm(claude, true)).toBe(true);
  });

  it("test_設定を外していれば確認しない", () => {
    expect(needsConfirm(claude, false)).toBe(false);
  });

  it("test_検索は確認しない（設定は生成AI向け）", () => {
    expect(needsConfirm(google, true)).toBe(false);
  });
});

describe("handoffUrl", () => {
  const claude = HANDOFFS.find((entry) => entry.id === "claude")!;
  const gemini = HANDOFFS.find((entry) => entry.id === "gemini")!;

  it("test_Claude には直接渡せる（貼り付けが要らない）", () => {
    // アプリの中の URL の口を見て決めた（claude://claude.ai/new?q=…）
    expect(handoffUrl(claude, "予算はどうなった？")).toBe(
      "claude://claude.ai/new?q=%E4%BA%88%E7%AE%97%E3%81%AF%E3%81%A9%E3%81%86%E3%81%AA%E3%81%A3%E3%81%9F%EF%BC%9F",
    );
  });

  it("test_口の無いアプリは null（クリップボード経由に倒す）", () => {
    expect(handoffUrl(gemini, "本文")).toBeNull();
  });

  it("test_長すぎるときも null（URL に載せきれない）", () => {
    // 日本語は 1 文字が 9 文字に膨らむ。載せきれないぶんは貼り付けで渡す
    expect(handoffUrl(claude, "あ".repeat(3000))).toBeNull();
  });
});

describe("searchUrl", () => {
  it("test_打った文字をそのまま探せる形にする", () => {
    expect(searchUrl("覚書 と 検索")).toBe(
      "https://www.google.com/search?q=%E8%A6%9A%E6%9B%B8%20%E3%81%A8%20%E6%A4%9C%E7%B4%A2",
    );
  });

  it("test_記号も壊さない", () => {
    expect(searchUrl("a&b=c")).toContain("a%26b%3Dc");
  });
});

describe("confirmMessage", () => {
  const claude = HANDOFFS.find((entry) => entry.id === "claude")!;

  it("test_どこへ何が出るかを書く", () => {
    const message = confirmMessage(claude, "選んだ文字");
    expect(message).toContain("Claude");
    expect(message).toContain("外");
  });

  it("test_長い文は頭だけ見せる（窓が画面からはみ出さない）", () => {
    const message = confirmMessage(claude, "あ".repeat(500));
    expect([...message].length).toBeLessThan(300);
    expect(message).toContain("…");
  });
});
