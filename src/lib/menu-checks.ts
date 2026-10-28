// 印つき（✓）メニュー項目の id（要望 2026-09-13）。Rust（menu.rs の
// `toggle(...)`）と同じもの。**状態を持つのは画面**（T2）で、Rust は言われた
// とおりに付け外しするだけ。id は fixtures/menu-checks.json が両側の真実で、
// ここと menu.rs のテストがそれと突き合わせる（15-14）。

import type { LlmEngine } from "./settings";

export const MENU_CHECK_IDS = [
  "toggle-trees",
  "toggle-notes",
  "outline",
  "assistant",
  "inline-mode",
  "source-mode",
  "preview-mode",
  "focus-mode",
  "typewriter",
  "llm-engine-ollama",
  "llm-engine-fm",
] as const;

export type MenuCheckId = (typeof MENU_CHECK_IDS)[number];

/// 送る形。**全部の id を必ず持つ** — 1 つずつ送ると送り忘れに気付けない
export type MenuChecks = Record<MenuCheckId, boolean>;

/// 編集モードの上 3 つ（インライン／ソース／プレビュー）は**排他**で、必ず
/// 1 つだけ ✓（要望 2026-09-15）。インラインは「どちらも切」の状態なので、
/// ここで導く（画面に 3 つめの真偽値を持たせない）。source と preview が
/// 同時に立つことは field 側の排他で起きないが、万一来ても 2 つ ✓ を出さない
export function editModeChecks(modes: {
  source: boolean;
  preview: boolean;
}): Pick<MenuChecks, "inline-mode" | "source-mode" | "preview-mode"> {
  const source = modes.source;
  const preview = !source && modes.preview;
  return {
    "inline-mode": !source && !preview,
    "source-mode": source,
    "preview-mode": preview,
  };
}

/// アシスタントの頼み先（ADR-0071）。**排他**で、選んだものだけ ✓。fm の無い Mac では
/// メニューに出ないが、送っても Rust が黙って飛ばす
export function engineChecks(
  engine: LlmEngine,
): Pick<MenuChecks, "llm-engine-ollama" | "llm-engine-fm"> {
  return {
    "llm-engine-ollama": engine === "ollama",
    "llm-engine-fm": engine === "fm",
  };
}
