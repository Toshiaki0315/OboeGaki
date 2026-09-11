// どこからでも書き取りのショートカット（ADR-0057 / 12-6）。設定の字を
// OS に登録し、押されたら書き取りの窓を出す（既にあれば前へ）。設定が
// 変われば付け替え、空なら外す。Tauri の外（素のブラウザ）では黙って何もしない

import { useEffect } from "react";
import { CAPTURE_LABEL, captureUrl } from "../lib/capture";

export async function openCaptureWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CAPTURE_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(CAPTURE_LABEL, {
    url: captureUrl(),
    title: "書き取り",
    width: 520,
    height: 260,
    minWidth: 320,
    minHeight: 160,
    center: true,
    alwaysOnTop: true,
    focus: true,
  });
}

export function useCaptureShortcut(shortcut: string): void {
  useEffect(() => {
    const key = shortcut.trim();
    if (!key) return;
    let registered = false;
    let cancelled = false;
    void import("@tauri-apps/plugin-global-shortcut")
      .then(async ({ register, unregister }) => {
        if (cancelled) return;
        await register(key, (event) => {
          if (event.state === "Pressed") void openCaptureWindow();
        });
        registered = true;
        if (cancelled) await unregister(key);
      })
      .catch(() => {
        // 登録できない（他のアプリが使っている・Tauri の外）ときは黙る
      });
    return () => {
      cancelled = true;
      if (registered) {
        void import("@tauri-apps/plugin-global-shortcut")
          .then(({ unregister }) => unregister(key))
          .catch(() => {});
      }
    };
  }, [shortcut]);
}
