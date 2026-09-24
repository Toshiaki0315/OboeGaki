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
  allow,
}: {
  checks: MenuChecks;
  actions: MenuActions;
  /// メニューバーから押されたとき、今この動作を通してよいか。窓（ダイアログ）が
  /// 開いている間にナビゲーション系が裏で動くと、窓の対象が入れ替わったり
  /// 打ちかけの名前が消える（レビュー 2026-09-24 / 21-3）。省くと全部通す。
  /// 画面の中からの `run` はこの判定を通らない（呼び手が状況を知っている）
  allow?: (id: string) => boolean;
}) {
  const latestActions = useLatest(actions);
  const latestChecks = useLatest(checks);
  const latestAllow = useLatest(allow);
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
    () =>
      subscribeMenu((id) => {
        if (latestAllow.current && !latestAllow.current(id)) return;
        latestActions.current[id]?.();
      }),
    [latestActions, latestAllow],
  );

  /// 画面の中から同じ動作を呼ぶ（歯車のメニュー）
  const run = (id: string) => latestActions.current[id]?.();
  return { run };
}
