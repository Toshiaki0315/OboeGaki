/// スライドの見た目（TASKS 5-5）。md2pptx のメタデータ相当を front matter で。
///
/// **ノートに書く。** 設定（環境設定）に置くと、資料ごとに変えられないうえ、
/// 別の機械で開いたときに再現しない。書いた本人の資料と一緒に運ぶ。
///
/// ```yaml
/// ---
/// slide-font: Hiragino Sans   # 見出しと本文の書体
/// slide-mono: Menlo           # コードの書体
/// slide-accent: "#44546A"     # 見出しの色・表の見出しの地
/// ---
/// ```
///
/// **読めない値は既定へ倒す。** 打ち間違いで書き出せなくなるより、既定で
/// 出るほうがよい（画面には front matter が出ないので、間違いに気づけない）。

import { parseFrontMatterMeta } from "../editor/frontmatter";

export type SlideTheme = {
  /// 見出しと本文の書体。空なら PowerPoint の既定
  font: string;
  /// コードの書体
  mono: string;
  /// 見出しと表の見出しの色（`RRGGBB`。pptxgenjs は `#` を付けない）
  accent: string;
};

export const DEFAULT_SLIDE_THEME: SlideTheme = {
  font: "",
  mono: "Menlo",
  accent: "44546A",
};

const COLOR = /^#?([0-9a-fA-F]{6})$/;

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const found = COLOR.exec(value.trim());
  return found ? found[1].toUpperCase() : fallback;
}

function readFont(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function readSlideTheme(markdownText: string): SlideTheme {
  const meta = parseFrontMatterMeta(markdownText);
  return {
    font: readFont(meta["slide-font"], DEFAULT_SLIDE_THEME.font),
    mono: readFont(meta["slide-mono"], DEFAULT_SLIDE_THEME.mono),
    accent: readColor(meta["slide-accent"], DEFAULT_SLIDE_THEME.accent),
  };
}
