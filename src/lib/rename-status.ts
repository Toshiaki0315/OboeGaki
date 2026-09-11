// 改名のあとに出す知らせ（ADR-0053）。`[[リンク]]` を書き換えた件数と、
// 書き換えられなかったノートの名前。何も無ければ空（ステータスを消す）。

import type { RenameOutcome } from "./ipc";

export function linksRewrittenText(outcome: RenameOutcome): string {
  const parts: string[] = [];
  if (outcome.rewritten > 0) {
    parts.push(`${outcome.rewritten} 件のノートのリンクを直しました`);
  }
  if (outcome.failed.length > 0) {
    parts.push(`直せなかった: ${outcome.failed.join("、")}`);
  }
  return parts.join("（") + (parts.length > 1 ? "）" : "");
}
