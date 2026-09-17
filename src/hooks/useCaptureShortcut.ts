// どこからでも書き取りのショートカット（ADR-0057 / 12-6）。設定の字を
// OS に登録し、押されたら書き取りの窓を出す（既にあれば前へ）。設定が
// 変われば付け替え、空なら外す。Tauri の外（素のブラウザ）では黙って何もしない。
// Tauri を呼ぶのは lib/ipc（ADR-0049）。登録できなかった理由は返す — 設定画面
// の欄の下に出す（以前は飲み込んでいて何も返らなかった。棚卸し 2026-09-17）

import { useEffect, useState } from "react";
import {
  openCaptureWindow,
  registerGlobalShortcut,
  unregisterGlobalShortcut,
} from "../lib/ipc";

export function useCaptureShortcut(shortcut: string): {
  /// 登録できなかった理由。できたか、空で外したなら null
  error: string | null;
} {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = shortcut.trim();
    setError(null);
    if (!key) return;
    let registered = false;
    let cancelled = false;
    void registerGlobalShortcut(key, () => void openCaptureWindow())
      .then(async () => {
        registered = true;
        // 登録が済む前に設定が変わっていたら、その場で外す
        if (cancelled) await unregisterGlobalShortcut(key);
      })
      .catch((reason: unknown) => {
        // 他のアプリが使っている・綴りが違う・Tauri の外。欄に理由を出す
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      if (registered) void unregisterGlobalShortcut(key).catch(() => {});
    };
  }, [shortcut]);
  return { error };
}
