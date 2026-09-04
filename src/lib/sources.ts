/// 質問に答える材料の選び方（L-2 / ADR-0025）。参照実装 core/llm.pack。
///
/// **材料はこちらが選ぶ。** 索引で候補を引き、その本文を渡す。モデルは
/// 探せないし、どのノートを見たかを画面に出せるのはこちら側だけ
/// （出典を作文させない）。

import { frontMatterRange } from "../editor/frontmatter";

/// 材料にするノートの数。多く渡すほど当たりは増えるが、**文脈から
/// あふれると黙って切れる**。5 本 × 2,000 字で 1 万字、日本語で約 5,000
/// トークン。指示と答えのぶんが残る。
export const SOURCE_LIMIT = 5;

/// 1 本あたりに渡す字数。
export const SOURCE_CHARS = 2000;

export type Hit = { path: string; title: string; snippet: string };

/// 語ごとに探した当たりを束ねる。**同じノートは一度だけ**、上から数本。
export function pickSources(hits: readonly Hit[]): Hit[] {
  const seen = new Set<string>();
  const found: Hit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    found.push(hit);
    if (found.length >= SOURCE_LIMIT) break;
  }
  return found;
}

/// 渡す材料を抑える。**front matter は外す**（画面に見えていないものを
/// 材料に混ぜない）。
export function packSources(
  notes: readonly { title: string; body: string }[],
): [string, string][] {
  return notes.slice(0, SOURCE_LIMIT).map((note) => {
    const range = frontMatterRange(note.body);
    const body = (range ? note.body.slice(range.bodyStart) : note.body).trim();
    return [note.title, [...body].slice(0, SOURCE_CHARS).join("")];
  });
}
