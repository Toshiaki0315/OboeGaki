// やること一覧（ADR-0056）。開いているノートの側で使う純関数。
// 閉じているノートは Rust（task_complete）が書く。

/// 0 始まりの行番号 → 行頭のオフセット。行が無ければ null
export function lineStartOffset(text: string, line: number): number | null {
  let offset = 0;
  for (let number = 0; number < line; number++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return null;
    offset = next + 1;
  }
  return offset <= text.length ? offset : null;
}

import { TASK_LINE_RE } from "./syntax";

/// その行がやることの印を持つか。持てば済んだかと本文
export function taskMarkerOf(
  line: string,
): { done: boolean; body: string } | null {
  const found = TASK_LINE_RE.exec(line);
  if (!found) return null;
  return { done: found[2] !== " ", body: found[4] ?? "" };
}

/// その行の `[ ]` / `[x]` を書き換える編集（Rust の set_task_done と同じ規則）。
/// 印が無ければ null
export function setTaskDone(
  text: string,
  line: number,
  done: boolean,
): { from: number; to: number; insert: string } | null {
  const from = lineStartOffset(text, line);
  if (from === null) return null;
  const end = text.indexOf("\n", from);
  const to = end < 0 ? text.length : end;
  const current = text.slice(from, to);
  const found = TASK_LINE_RE.exec(current);
  if (!found) return null;
  const tail = found[3] === undefined ? "" : `${found[3]}${found[4]}`;
  const insert = `${found[1]}${done ? "[x]" : "[ ]"}${tail}`;
  return { from, to, insert };
}

/// `completeMatching` の答え（Rust の `tasks::Completion` と同じ 3 つ）
export type Completion =
  | { kind: "edit"; edit: { from: number; to: number; insert: string } }
  | { kind: "done" }
  | { kind: "mismatch" };

/// 一覧（索引の写し）から来た行番号で完了にする。**文も突き合わせる** —
/// 一覧は保存後の索引から作るので、開いているノートで上に行を足した直後は
/// 同じ番号が別のやることを指す（Rust の complete_matching と同じ規則。
/// レビュー 2026-09-27）。コードフェンスの中の行はやることとして扱わない
export function completeMatching(
  text: string,
  line: number,
  expected: string,
): Completion {
  const lines = text.split("\n");
  if (line < 0 || line >= lines.length) return { kind: "mismatch" };
  let inFence = false;
  for (let number = 0; number < line; number++) {
    const trimmed = lines[number].trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~"))
      inFence = !inFence;
  }
  if (inFence) return { kind: "mismatch" };
  const marker = taskMarkerOf(lines[line]);
  if (!marker || marker.body.trim() !== expected) return { kind: "mismatch" };
  if (marker.done) return { kind: "done" };
  const edit = setTaskDone(text, line, true);
  return edit ? { kind: "edit", edit } : { kind: "mismatch" };
}
