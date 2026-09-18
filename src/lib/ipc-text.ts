// 保管フォルダ全体の置換とタグの改名（ADR-0055 / 12-3）。
// Tauri コマンドの薄い包み（分け方は ipc.ts を見る）。

import { invoke } from "@tauri-apps/api/core";

// ---- 保管フォルダ全体の置換（ADR-0055 / 12-3）

export type ReplaceOptions = { caseSensitive: boolean; includeCode: boolean };

export type ReplaceCount = { notes: number; occurrences: number };

export type ReplaceOutcome = ReplaceCount & {
  paths: string[];
  failed: string[];
};

/// 書かずに数えるだけ（押す前に件数を見せる）
export async function replacePreview(
  root: string,
  from: string,
  options: ReplaceOptions,
): Promise<ReplaceCount> {
  return invoke<ReplaceCount>("replace_preview", {
    root,
    from,
    caseSensitive: options.caseSensitive,
    includeCode: options.includeCode,
  });
}

export async function replaceApply(
  root: string,
  from: string,
  to: string,
  options: ReplaceOptions,
): Promise<ReplaceOutcome> {
  return invoke<ReplaceOutcome>("replace_apply", {
    root,
    from,
    to,
    caseSensitive: options.caseSensitive,
    includeCode: options.includeCode,
  });
}

/// タグの改名・統合（ADR-0055 / 12-4）。統合かどうかの判断と確認はフロント
export async function renameTag(
  root: string,
  from: string,
  to: string,
): Promise<ReplaceOutcome> {
  return invoke<ReplaceOutcome>("tag_rename", { root, from, to });
}
