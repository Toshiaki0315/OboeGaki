// タグの改名・統合（ADR-0055 / 12-4）。押す前に何が起きるかを決める純関数。
// 索引のタグは小文字フルパス（spec §7.3）で持つので、比較も小文字で行う。

export type TagRenamePlan =
  | { kind: "rename"; to: string }
  | { kind: "merge"; to: string }
  | { kind: "same" }
  | { kind: "invalid" };

export function tagRenamePlan(
  tags: readonly string[],
  from: string,
  typed: string,
): TagRenamePlan {
  const to = typed.trim().replace(/^#+/, "");
  if (!to || /[\s#]/.test(to)) return { kind: "invalid" };
  const key = to.toLowerCase();
  if (key === from.toLowerCase()) return { kind: "same" };
  if (tags.some((tag) => tag.toLowerCase() === key))
    return { kind: "merge", to };
  return { kind: "rename", to };
}
