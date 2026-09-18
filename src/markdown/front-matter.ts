// front matter の範囲と `key: スカラー` の読み取り（ADR-0013 / ADR-0042）。
// CM6 に依存しない純関数。エディタの隠蔽（editor/frontmatter.ts）と書き出し・
// 印刷・スライドの題材が同じ判定を使う。Rust `front_matter::block_len` と同じ規則で、
// 共有の見本 fixtures/front-matter-cases.json が両側を見張る。
// メタデータが壊れていても本文は必ず開ける（G3）— 読めない行は黙って飛ばす

export type FrontMatterRange = {
  from: 0;
  to: number;
  /** 本文の開始位置（閉じ区切りの改行の次。無ければ文書末） */
  bodyStart: number;
};

// 1 行目がちょうど `---` で始まり、行頭の `---` で閉じられている場合だけ
// front matter（Rust `front_matter::block_len` と同じ規則。共有の見本
// fixtures/front-matter-cases.json が両側を見張る）。中身が空の `---\n---`
// も front matter（棚卸し 2026-09-17: Rust は受け、こちらは受けていなかった）。
// 閉じが無いものは「ただの水平線で始まる本文」。
const FRONT_MATTER_RE = /^---[ \t]*\n(?:[\s\S]*?\n)?---[ \t]*(?=\n|$)/;

export function frontMatterRange(text: string): FrontMatterRange | null {
  if (!text.startsWith("---")) return null;
  const found = FRONT_MATTER_RE.exec(text);
  if (!found) return null;
  const to = found[0].length;
  return { from: 0, to, bodyStart: Math.min(to + 1, text.length) };
}

/// front matter を落とした本文（書き出しと印刷が読む。3 か所で同じ切り方を
/// 持っていたのを 1 つに。17-6）
export function bodyText(text: string): string {
  const range = frontMatterRange(text);
  return range ? text.slice(range.bodyStart) : text;
}

/// front matter の `key: スカラー` を読む。true/false・数値・引用符付き
/// 文字列・素の文字列だけ。入れ子や配列など読めないものは黙って飛ばす。
export function parseFrontMatterMeta(text: string): Record<string, unknown> {
  const range = frontMatterRange(text);
  if (!range) return {};
  const meta: Record<string, unknown> = {};
  for (const line of text.slice(4, range.to - 3).split("\n")) {
    const found = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (!found) continue;
    const [, key, raw] = found;
    if (raw === "true") meta[key] = true;
    else if (raw === "false") meta[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) meta[key] = Number(raw);
    else if (/^".*"$/.test(raw) || /^'.*'$/.test(raw))
      meta[key] = raw.slice(1, -1);
    else meta[key] = raw;
  }
  return meta;
}

/// 現在の front matter の範囲。本文だけの編集では再走査せず位置を写す。
