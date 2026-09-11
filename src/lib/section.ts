// 埋め込み `![[ノート名#見出し]]`（ADR-0058 / 12-7）の名前の分け方と、見出しの
// 節の切り出し。純関数。

/// `名前#見出し` → 名前と見出し（無ければ null）。前後の空白は落とす
export function splitEmbedTarget(target: string): {
  name: string;
  heading: string | null;
} {
  const hash = target.indexOf("#");
  if (hash < 0) return { name: target.trim(), heading: null };
  const heading = target.slice(hash + 1).trim();
  return { name: target.slice(0, hash).trim(), heading: heading || null };
}

/// その見出しの節: 見出しの行から、同じか浅い次の見出しの手前まで（深い
/// 小見出しは含む）。見出しの比較は大小と前後の空白を無視。無ければ null。
/// コードフェンスの中の `#` は見出しに数えない
export function sectionOf(text: string, heading: string): string | null {
  const wanted = heading.trim().toLowerCase();
  if (!wanted) return null;
  const lines = text.split("\n");
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const found = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!found) continue;
    if (start < 0) {
      if (found[2].trim().toLowerCase() === wanted) {
        start = index;
        level = found[1].length;
      }
    } else if (found[1].length <= level) {
      return lines.slice(start, index).join("\n").replace(/\n*$/, "\n");
    }
  }
  if (start < 0) return null;
  return lines.slice(start).join("\n").replace(/\n*$/, "\n");
}
