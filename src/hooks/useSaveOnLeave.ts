// フォーカスが外れる・窓が隠れる・窓を閉じるときに、打ちかけを書き切る
// （spec §7.4 の保存の契機。24-1）。以前はどれも受けておらず、打って 0.8 秒以内に
// Cmd+W や窓の赤いボタンで閉じると最後の字が消えた。アプリの終了（Cmd+Q）は
// メニューの「終了」が書き切ってから終える（App の "app-quit"）

import { useEffect } from "react";
import { onMainWindowCloseRequested } from "../lib/ipc";
import { useLatest } from "./useLatest";

export function useSaveOnLeave(flush: () => Promise<void>): void {
  const latest = useLatest(flush);
  useEffect(() => {
    // 失敗は保存の側が知らせと退避で扱う。ここで止めない
    const save = () => latest.current().catch(() => {});
    const onBlur = () => void save();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void save();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    // 閉じるのは書き終えてから（Tauri が Promise を待つ）
    const stop = onMainWindowCloseRequested(save);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [latest]);
}
