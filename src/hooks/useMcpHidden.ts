// 「Claude に渡さない」の一覧と付け外し（ADR-0049 / 15-14。App.tsx から出した）。
// 真実は保管フォルダ直下の `.mcp-ignore`。ここはその写しを持ち、判断は
// lib/mcp-hidden の純関数に任せる。Rust への包みは lib/ipc。

import { useCallback, useEffect, useState } from "react";
import { mcpHidden, setMcpHidden } from "../lib/ipc";
import { NO_MCP_HIDDEN, type McpHidden } from "../lib/mcp-hidden";

export function useMcpHidden(vaultRoot: string | null): {
  hidden: McpHidden;
  /// 付け外して、新しい一覧に差し替える（返り値も同じ一覧）
  setHidden: (relative: string, hidden: boolean) => Promise<McpHidden>;
} {
  const [hidden, setHiddenList] = useState<McpHidden>(NO_MCP_HIDDEN);

  // **窓に戻るたびに読み直す** — `.mcp-ignore` は `.md` ではないので監視が
  // 拾わず、手で直しても同期で降ってきても印が古いままだった
  // （レビュー 2026-09-13。ADR-0052 の共有フォルダで実際に起こる）
  useEffect(() => {
    if (!vaultRoot) {
      setHiddenList(NO_MCP_HIDDEN);
      return;
    }
    let alive = true;
    const read = () => {
      mcpHidden(vaultRoot)
        .then((found) => alive && setHiddenList(found))
        .catch(() => alive && setHiddenList(NO_MCP_HIDDEN));
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      window.removeEventListener("focus", read);
    };
  }, [vaultRoot]);

  const setHidden = useCallback(
    async (relative: string, value: boolean) => {
      if (!vaultRoot) return NO_MCP_HIDDEN;
      const next = await setMcpHidden(vaultRoot, relative, value);
      setHiddenList(next);
      return next;
    },
    [vaultRoot],
  );

  return { hidden, setHidden };
}
