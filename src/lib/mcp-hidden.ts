// 「Claude に渡さない」の判定（ADR-0051 / 要望 2026-09-12）。真実は保管
// フォルダ直下の `.mcp-ignore` で、ここはその中身と道を突き合わせるだけ。
// 規則は Rust の `mcp::IgnoreList::is_ignored` と同じ — **区切りで見る**
// （「プライベート」は「プライベート2」を隠さない）。

/// 保管フォルダからの相対の道。絶対パスで来たら root を外す
export function relativeIn(root: string, path: string): string {
  if (!path.startsWith(root)) return path.replace(/^\/+|\/+$/g, "");
  return path.slice(root.length).replace(/^\/+|\/+$/g, "");
}

/// Rust から受け取る「見せない場所」。**最初から見せない場所（`builtin`）も
/// 一緒に受け取る** — こちらで `.trash` などを並べ直すと、Rust 側の
/// SKIP_DIRS が増えたときに黙って食い違う（レビュー 2026-09-13）
export type McpHidden = {
  /// `.mcp-ignore` に書いてある道（人が決めたもの）
  listed: string[];
  /// 書かなくても見せない場所（ゴミ箱・雛形・管理フォルダ・添付）
  builtin: string[];
};

export const NO_MCP_HIDDEN: McpHidden = { listed: [], builtin: [] };

/// その道が Claude から見えないか（名指し、またはその中）。
/// 規則は Rust の `mcp::IgnoreList::is_ignored` と同じ:
/// **区切りで見る**（「プライベート」は「プライベート2」を隠さない）／
/// 先頭の成分がドットで始まるものも見せない
export function isHiddenFromMcp(hidden: McpHidden, relative: string): boolean {
  if (!relative) return false;
  if (relative.split("/")[0].startsWith(".")) return true;
  return [...hidden.listed, ...hidden.builtin].some(
    (entry) => relative === entry || relative.startsWith(`${entry}/`),
  );
}
