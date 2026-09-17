// どこからでも書き取りのショートカット（ADR-0057 / 12-6）。設定の字を
// OS に登録し、押されたら書き取りの窓を出す（既にあれば前へ）。設定が
// 変われば付け替え、空なら外す。Tauri の外（素のブラウザ）では黙って何もしない。
// Tauri を呼ぶのは lib/ipc（ADR-0049。棚卸し 2026-09-17: 直接 import して
// いたので差し替えて試せなかった）

import { useEffect } from "react";
import {
  openCaptureWindow,
  registerGlobalShortcut,
  unregisterGlobalShortcut,
} from "../lib/ipc";

export function useCaptureShortcut(shortcut: string): void {
  useEffect(() => {
    const key = shortcut.trim();
    if (!key) return;
    let registered = false;
    let cancelled = false;
    void registerGlobalShortcut(key, () => void openCaptureWindow())
      .then(async () => {
        registered = true;
        // 登録が済む前に設定が変わっていたら、その場で外す
        if (cancelled) await unregisterGlobalShortcut(key);
      })
      .catch(() => {
        // 登録できない（他のアプリが使っている・Tauri の外）ときは黙る
      });
    return () => {
      cancelled = true;
      if (registered) void unregisterGlobalShortcut(key).catch(() => {});
    };
  }, [shortcut]);
}
