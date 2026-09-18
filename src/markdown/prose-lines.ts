// front matter とコードフェンスの外の行（19-3）。埋め込みの収集・最初の見出し・
// 文体の検査が各自で ``` のトグルと `---` の読み飛ばしを書いていた（3 か所）。
// front matter の判定は front-matter.ts と同じ（閉じていない `---` は本文）。
// フェンスは ``` / ~~~ で始まる行のトグル（種類と長さは見ない。厳密な規則が要る
// 節の切り出しは section.ts が別に持つ）

import { frontMatterRange } from "./front-matter";

export function proseLines(text: string): { offset: number; line: string }[] {
  const found: { offset: number; line: string }[] = [];
  const bodyStart = frontMatterRange(text)?.bodyStart ?? 0;
  let offset = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (start < bodyStart) continue;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    found.push({ offset: start, line });
  }
  return found;
}
