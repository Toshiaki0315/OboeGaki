// CSV を表にする（要望 2026-09-06。ノートへ落とすと本文に表が入る）。
//
// **Excel から来るものが読めること**を第一にした（RFC 4180 相当）:
// 引用の中の区切りと改行、二重の引用符、CRLF、最後の改行が無い形。
//
// **落とさない。** 列の数が揃っていない CSV でも、多いほうに合わせて
// 空のセルを足す — 黙って切ると、書いた人は気づけない。

type FileLike = { name?: string; type?: string };

/// 落とされたものを CSV として扱うか。
export function isCsvFile(file: FileLike): boolean {
  if (file.type === "text/csv") return true;
  const name = file.name ?? "";
  return /\.csv$/i.test(name);
}

/// CSV を行と列に割る。**空の行は落とす**（末尾の改行で行が増えない）。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let touched = false; // この行に何か書いてあったか
  const endCell = () => {
    row.push(quoted ? cell : cell.trim());
    cell = "";
    quoted = false;
  };
  const endRow = () => {
    endCell();
    if (touched) rows.push(row);
    row = [];
    touched = false;
  };
  const chars = [...text];
  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at];
    if (char === '"' && !cell) {
      // セルの頭の引用符。中身を読み切ってから次へ
      quoted = true;
      touched = true;
      at += 1;
      for (; at < chars.length; at += 1) {
        if (chars[at] !== '"') {
          cell += chars[at];
          continue;
        }
        // `""` は引用符 1 つぶん。そうでなければここで終わり
        if (chars[at + 1] === '"') {
          cell += '"';
          at += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (char === ",") {
      endCell();
      touched = true;
      continue;
    }
    if (char === "\n" || char === "\r") {
      // CRLF は 1 つの改行として数える
      if (char === "\r" && chars[at + 1] === "\n") at += 1;
      endRow();
      continue;
    }
    cell += char;
    if (char.trim()) touched = true;
  }
  endRow();
  return rows;
}

/// セルを Markdown の表に置ける形にする。
function cellText(text: string): string {
  return (
    text
      // **縦棒は逃がす**（そのままだと列が割れて表が壊れる）
      .replace(/\|/g, "\\|")
      // 改行は空白へ。行の中に改行は置けない（`<br>` は書き出しで無効）
      .replace(/\s*\n\s*/g, " ")
      .trim()
  );
}

/// 行と列を Markdown の表にする。**1 行目を見出しにする。**
export function csvToMarkdown(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "";
  const columns = Math.max(...rows.map((row) => row.length));
  const line = (row: readonly string[]) =>
    `| ${Array.from({ length: columns }, (_, at) => cellText(row[at] ?? "")).join(" | ")} |`;
  const rule = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  return [line(rows[0]), rule, ...rows.slice(1).map(line)].join("\n") + "\n";
}
