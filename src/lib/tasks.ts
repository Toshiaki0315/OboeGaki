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

/// 印の後ろは空白か行末。Rust `tasks::task_marker` と同じ規則で、共有の
/// 見本（fixtures/task-marker-cases.json）が両側を見張る（棚卸し 2026-09-17:
/// TS だけが `- [ ]a` を印と見なしていた）
const TASK_LINE_RE = /^([ \t]*(?:[-*+]|\d{1,9}[.)]) )\[( |x|X)\](?:( )(.*)|$)/;

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
