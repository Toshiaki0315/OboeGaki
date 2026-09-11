// 履歴の差分（ADR-0054）。行単位の LCS。ノート 1 本の行数なら O(nm) で
// 足りる（5,000 行 × 5,000 行で 25M 比較 = 数十 ms）。語単位の強調はしない —
// 日本語は分かち書きが無く文字単位になって読めない。

export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export type DiffRow = DiffLine | { kind: "skip"; count: number };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // 末尾の改行は「最後の行の終わり」であって空行ではない
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/// before → after の行の差分。
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  // LCS の長さの表（後ろから）。行数分の Uint32 の帯で持つ
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

/// 変わらない行の長い並びを畳む。変化の前後 `context` 行は残し、それより
/// 内側は `skip`（何行畳んだか）にする。変化が無ければ全部 1 つの skip
export function foldSame(lines: readonly DiffLine[], context = 3): DiffRow[] {
  const out: DiffRow[] = [];
  let run: DiffLine[] = [];
  const flush = (atStart: boolean, atEnd: boolean) => {
    if (run.length === 0) return;
    const keepHead = atStart ? 0 : context;
    const keepTail = atEnd ? 0 : context;
    if (run.length <= keepHead + keepTail) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepHead));
      out.push({ kind: "skip", count: run.length - keepHead - keepTail });
      out.push(...run.slice(run.length - keepTail));
    }
    run = [];
  };
  let seenChange = false;
  for (const line of lines) {
    if (line.kind === "same") {
      run.push(line);
      continue;
    }
    flush(!seenChange, false);
    seenChange = true;
    out.push(line);
  }
  flush(!seenChange, true);
  return out;
}
