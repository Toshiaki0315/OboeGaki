// クイックオープン（Cmd+O、spec §5.4）のファジー一致。
//
// クエリが候補の部分列として現れれば一致。連続・先頭（またはフォルダ
// 区切りの直後）を高く採点して、直感的な順位にする。

const CHAR_POINT = 2;
const CONSECUTIVE_BONUS = 3;
const BOUNDARY_BONUS = 5;

/// 一致すれば点数、しなければ null。
export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = [...query.toLowerCase()];
  const haystack = [...candidate.toLowerCase()];
  if (needle.length === 0) return 0;

  let score = 0;
  let cursor = 0;
  let previousMatch = -2;
  for (const wanted of needle) {
    let found = -1;
    for (let index = cursor; index < haystack.length; index++) {
      if (haystack[index] === wanted) {
        found = index;
        break;
      }
    }
    if (found < 0) return null;
    score += CHAR_POINT;
    if (found === previousMatch + 1) score += CONSECUTIVE_BONUS;
    if (found === 0 || haystack[found - 1] === "/") score += BOUNDARY_BONUS;
    previousMatch = found;
    cursor = found + 1;
  }
  return score;
}

/// 一致する候補の添字を、点の高い順（同点は元の順）で返す。
export function rankCandidates(query: string, candidates: string[]): number[] {
  return candidates
    .map((candidate, index) => ({ index, score: fuzzyScore(query, candidate) }))
    .filter(
      (entry): entry is { index: number; score: number } =>
        entry.score !== null,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.index);
}
