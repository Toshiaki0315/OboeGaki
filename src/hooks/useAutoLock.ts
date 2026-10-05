// 自動施錠（TASKS 13-3 / ADR-0062）。解錠している間、キーやポインタを触らないまま
// minutes 分が過ぎたら onLock を呼ぶ。狙いは「席を外した隙に読まれない」（決定 2）。
//
// タイマーはスリープ中に止まるので、**画面に戻った瞬間にも**最後に触った時刻から
// 測り直す（蓋を閉じて 1 時間後に開いたら、開いた瞬間に施錠されているべき）。

import { useEffect, useRef } from "react";
import { useLatest } from "./useLatest";

/// 見る間隔。施錠が遅れても高々これだけ
const CHECK_MS = 15_000;

export function useAutoLock({
  unlocked,
  minutes,
  onLock,
}: {
  unlocked: boolean;
  minutes: number;
  onLock: () => void;
}) {
  const lastActive = useRef(Date.now());
  const latest = useLatest({ minutes, onLock });

  useEffect(() => {
    if (!unlocked) return;
    lastActive.current = Date.now();
    // 1 度施錠を頼んだら、次に触るまでは頼み直さない（親が解錠中を下ろすまでの間に
    // 何度も施錠させない）
    let fired = false;
    const touch = () => {
      lastActive.current = Date.now();
      fired = false;
    };
    const check = () => {
      if (fired) return;
      const idle = Date.now() - lastActive.current;
      if (idle >= latest.current.minutes * 60_000) {
        fired = true;
        latest.current.onLock();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") check();
    };
    window.addEventListener("keydown", touch, true);
    window.addEventListener("pointerdown", touch, true);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_MS);
    return () => {
      window.removeEventListener("keydown", touch, true);
      window.removeEventListener("pointerdown", touch, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [unlocked, latest]); // latest は不変の ref（lint が useLatest を ref と知らない）
}
