// 「Claude に渡さない」の判定（ADR-0051 / 要望 2026-09-12）。真実は保管
// フォルダ直下の `.mcp-ignore` で、ここはその中身と道を突き合わせるだけ。
// 規則は Rust の `mcp::IgnoreList::is_ignored` と同じ — **区切りで見る**
// （「プライベート」は「プライベート2」を隠さない）。

/// 保管フォルダからの相対の道。絶対パスで来たら root を外す
export function relativeIn(root: string, path: string): string {
  if (!path.startsWith(root)) return path.replace(/^\/+|\/+$/g, "");
  return path.slice(root.length).replace(/^\/+|\/+$/g, "");
}

/// その道が Claude から見えないか（名指し、またはその中）
export function isHiddenFromMcp(
  hidden: readonly string[],
  relative: string,
): boolean {
  if (!relative) return false;
  return hidden.some(
    (entry) => relative === entry || relative.startsWith(`${entry}/`),
  );
}
