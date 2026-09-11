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
  const found = /^(\s*[-*+] )\[( |x|X)\]( ?)(.*)$/.exec(current);
  if (!found) return null;
  const insert = `${found[1]}${done ? "[x]" : "[ ]"}${found[3]}${found[4]}`;
  return { from, to, insert };
}
