// 環境設定・本文の文字サイズ・PowerPoint の書き出し設定（19-4 で App.tsx から
// 切り出した）。**変えたらすぐ効かせて覚える**（置き場は localStorage。PowerPoint は
// 大きな入れ子なので別の鍵）。ダイアログの開閉は App が持つ（ADR-0048: 開閉だけ）

import { useState } from "react";
import { useLatest } from "./useLatest";
import {
  clampFontSize,
  DEFAULT_FONT_PX,
  loadFontSize,
  saveFontSize,
} from "../lib/font-size";
import {
  DEFAULT_PPTX_SETTINGS,
  loadPptxSettings,
  resetPptxSettings as clearPptxSettings,
  savePptxSettings,
  type PptxSettings,
} from "../lib/pptx-settings";
import {
  clampPaneWidth,
  cleanSettingsPatch,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "../lib/settings";

export function usePreferences(storage: Storage = localStorage) {
  const [settings, setSettings] = useState<Settings>(() =>
    loadSettings(storage),
  );
  const settingsRef = useLatest(settings);

  function changeSettings(next: Partial<Settings>) {
    // 読めない数値だけ捨てる（規則は lib/settings の cleanSettingsPatch。
    // 履歴の「なし」= 0 を捨てないため項目ごとに見る）
    const cleaned = cleanSettingsPatch(next);
    setSettings((current) => {
      const merged = { ...current, ...cleaned };
      saveSettings(storage, merged);
      return merged;
    });
  }

  // 本文の文字サイズ（Cmd+= / Cmd+-、TASKS 1-5）。変えたら覚える
  const [fontSize, setFontSize] = useState(() => loadFontSize(storage));
  function changeFontSize(px: number) {
    const next = clampFontSize(px);
    setFontSize(next);
    saveFontSize(storage, next);
  }

  function resetPreferences() {
    // ダイアログに出ている項目だけを既定へ（ペイン幅や開閉は触らない）
    changeSettings({
      theme: DEFAULT_SETTINGS.theme,
      contentWidth: DEFAULT_SETTINGS.contentWidth,
      bodyFont: DEFAULT_SETTINGS.bodyFont,
      monoFont: DEFAULT_SETTINGS.monoFont,
      tabWidth: DEFAULT_SETTINGS.tabWidth,
      indentedCode: DEFAULT_SETTINGS.indentedCode,
      lineSpacing: DEFAULT_SETTINGS.lineSpacing,
      historyMinutes: DEFAULT_SETTINGS.historyMinutes,
      trashDays: DEFAULT_SETTINGS.trashDays,
      llmModel: DEFAULT_SETTINGS.llmModel,
      llmPort: DEFAULT_SETTINGS.llmPort,
      llmContext: DEFAULT_SETTINGS.llmContext,
      llmTimeoutMinutes: DEFAULT_SETTINGS.llmTimeoutMinutes,
      llmKeepAlive: DEFAULT_SETTINGS.llmKeepAlive,
      ocrEngine: DEFAULT_SETTINGS.ocrEngine,
    });
    changeFontSize(DEFAULT_FONT_PX);
  }

  /// ペインの幅をドラッグで変える（spec §5.1）。`direction` は掴んだ帯が
  /// 右へ動いたときに広がるなら 1、狭まるなら -1。
  function startResize(
    event: React.PointerEvent<HTMLDivElement>,
    key: "listWidth" | "outlineWidth",
    direction: 1 | -1,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = settingsRef.current[key];
    const move = (moved: PointerEvent) => {
      const width = clampPaneWidth(
        startWidth + (moved.clientX - startX) * direction,
        startWidth,
      );
      // 引きずっている間は覚えない（放したときに 1 回だけ書く）
      setSettings((current) => ({ ...current, [key]: width }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      saveSettings(storage, settingsRef.current);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    // pointerup が来ない経路（capture の横取り・フォーカス喪失）でも
    // move が生き残らないように（レビュー 2026-09-04）
    window.addEventListener("pointercancel", stop, { once: true });
  }

  // PowerPoint の書き出し設定（TASKS 8-1 / 8-2）。**置き場は別の鍵** —
  // 大きな入れ子なので、ほかの設定と混ぜない
  const [pptxSettings, setPptxSettings] = useState<PptxSettings>(() => {
    try {
      return loadPptxSettings(storage);
    } catch {
      return DEFAULT_PPTX_SETTINGS;
    }
  });

  function changePptxSettings(patch: Partial<PptxSettings>) {
    setPptxSettings((current) => {
      const next = { ...current, ...patch };
      try {
        savePptxSettings(storage, next);
      } catch {
        // 置けなくてもこの回は効かせる
      }
      return next;
    });
  }

  function resetPptxSettings() {
    clearPptxSettings(storage);
    setPptxSettings(DEFAULT_PPTX_SETTINGS);
  }

  return {
    settings,
    /// 一度だけ登録するハンドラが最新の設定を読むための ref
    settingsRef,
    changeSettings,
    resetPreferences,
    startResize,
    fontSize,
    changeFontSize,
    pptxSettings,
    changePptxSettings,
    resetPptxSettings,
  };
}
