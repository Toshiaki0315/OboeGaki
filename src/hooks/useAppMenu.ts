// ネイティブのメニューバーとの配線（19-4）。押されたら `actions[id]` を呼び、
// 印（✓）は状態が変わるたびに**全部まとめて**送る（1 つずつ送ると送り忘れに
// 気付けない）。**状態を持つのは画面**（T2）で、Rust は言われたとおりに付け外し
// するだけ。ハンドラは一度だけ登録し、最新の動作は ref 経由で読む。
// `checks` は MenuChecks（全部の id を必ず持つ型）なので、項目を足して送り忘れると
// 型で気付く

import { useEffect } from "react";
import { MENU_CHECK_IDS, type MenuChecks } from "../lib/menu-checks";
import { setMenuChecks, subscribeMenu } from "../lib/ipc";
import { useLatest } from "./useLatest";

export type MenuActions = Record<string, () => void>;

export function useAppMenu({
  checks,
  actions,
}: {
  checks: MenuChecks;
  actions: MenuActions;
}) {
  const latestActions = useLatest(actions);
  const latestChecks = useLatest(checks);
  // 印の中身が変わったときだけ送る（オブジェクトは毎描画で新しくなるので字で比べる）
  const signature = MENU_CHECK_IDS.map((id) => (checks[id] ? "1" : "0")).join(
    "",
  );
  useEffect(() => {
    void setMenuChecks(latestChecks.current).catch(() => {
      // メニューの印が付かないだけ。書けなくなるわけではない
    });
  }, [signature, latestChecks]);

  useEffect(
    () => subscribeMenu((id) => latestActions.current[id]?.()),
    [latestActions],
  );

  /// 画面の中から同じ動作を呼ぶ（歯車のメニュー）
  const run = (id: string) => latestActions.current[id]?.();
  return { run };
}
