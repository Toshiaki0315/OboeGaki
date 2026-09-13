// 印つき（✓）メニュー項目の id（要望 2026-09-13）。Rust（lib.rs の
// `toggle(...)`）と同じ 7 つ。**状態を持つのは画面**（T2）で、Rust は言われた
// とおりに付け外しするだけ。id は fixtures/menu-checks.json が両側の真実で、
// ここと lib.rs のテストがそれと突き合わせる（15-14）。

export const MENU_CHECK_IDS = [
  "toggle-trees",
  "toggle-notes",
  "outline",
  "assistant",
  "source-mode",
  "focus-mode",
  "typewriter",
] as const;

export type MenuCheckId = (typeof MENU_CHECK_IDS)[number];

/// 送る形。**全部の id を必ず持つ** — 1 つずつ送ると送り忘れに気付けない
export type MenuChecks = Record<MenuCheckId, boolean>;
