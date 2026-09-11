// 改名のあとに出す知らせ（ADR-0053）。改名したことを軸に、`[[リンク]]` を
// 書き換えた件数と、書き換えられなかったノートの名前を添える。件数が 0 でも
// 「改名しました」は出す（実機 2026-09-11: 何も出ないと動いたか分からない）

import type { RenameOutcome } from "./ipc";
import { noteStem } from "./note-path";

export function renameStatusText(outcome: RenameOutcome): string {
  const parts: string[] = [];
  if (outcome.rewritten > 0) {
    parts.push(`${outcome.rewritten} 件のノートのリンクを直しました`);
  }
  if (outcome.failed.length > 0) {
    parts.push(`直せなかった: ${outcome.failed.join("、")}`);
  }
  const head = `「${noteStem(outcome.path)}」に改名しました`;
  return parts.length ? `${head}（${parts.join("。")}）` : head;
}
