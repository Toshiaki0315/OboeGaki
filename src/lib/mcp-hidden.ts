// 「Claude に渡さない」の判定（ADR-0051 / 要望 2026-09-12）。真実は保管
// フォルダ直下の `.mcp-ignore` で、ここはその中身と道を突き合わせるだけ。
// 規則は Rust の `mcp::IgnoreList::is_ignored` と同じ — **区切りで見る**
// （「プライベート」は「プライベート2」を隠さない）。

/// 保管フォルダからの相対の道。絶対パスで来たら root を外す。
/// **区切りで見る**（`/vault2/a.md` は `/vault` の中ではない）— Rust の
/// `strip_prefix` が成分単位なのと揃える
export function relativeIn(root: string, path: string): string {
  const base = root.replace(/\/+$/, "");
  const inside = path === base || path.startsWith(`${base}/`);
  const rest = inside ? path.slice(base.length) : path;
  return rest.replace(/^\/+|\/+$/g, "");
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
/// ドットで始まる成分が**どの階層にあっても**見せない（`scan()` が各階層で
/// ドットフォルダを飛ばすのと揃える。15-12）
export function isHiddenFromMcp(hidden: McpHidden, relative: string): boolean {
  if (!relative) return false;
  // Rust と同じ字面で比べる（NFC・成分の前後の空白を落とす・小文字。24-2）。
  // 共有の見本 fixtures/mcp-ignore-cases.json が両側を見張る
  const target = matchKey(relative);
  if (target.split("/").some((part) => part.startsWith("."))) return true;
  return [...hidden.listed, ...hidden.builtin].some((raw) => {
    const entry = matchKey(raw);
    return target === entry || target.startsWith(`${entry}/`);
  });
}

/// 照合に使う字面（Rust の `match_key` と同じ）。NFC に寄せ（Finder が作った名前は
/// NFD で来る）、成分ごとに前後の空白を落とし、小文字にする（APFS は大文字小文字を
/// 区別しない。24-2）
function matchKey(path: string): string {
  return path
    .normalize("NFC")
    .split("/")
    .map((part) => part.trim())
    .join("/")
    .toLowerCase();
}

/// その道を**親ごと**隠している場所（`.mcp-ignore` の行、または最初から
/// 見せない場所）。自分が名指しされているなら null — 自分の行を消せば
/// 外せる。親由来なら、自分の行を消しても親の行が残って何も変わらない
/// ので、「渡す」を押せるように見せてはいけない（レビュー 2026-09-14）
export function hiddenByAncestor(
  hidden: McpHidden,
  relative: string,
): string | null {
  if (!relative) return null;
  const target = matchKey(relative);
  // 途中のドット始まりの成分（そこまでの道が「親」）
  const parts = relative.normalize("NFC").split("/");
  for (let depth = 0; depth < parts.length - 1; depth++) {
    if (parts[depth].trim().startsWith("."))
      return parts.slice(0, depth + 1).join("/");
  }
  for (const raw of [...hidden.listed, ...hidden.builtin]) {
    const entry = matchKey(raw);
    // 返すのは書いてある字面（NFC）。照合だけをそろえた字面で行う
    if (entry !== target && target.startsWith(`${entry}/`))
      return raw.normalize("NFC");
  }
  return null;
}
