// 環境設定ダイアログ（TASKS 3-9）の殻。タブの切り替え・キャンセルで戻す
// ためのスナップショット・履歴の使用量とモデル一覧の取り寄せは、開いて
// いる間だけ要るものなので**ここで閉じる**。設定そのものは親（App）が持つ。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  availableFonts,
  BODY_FONTS,
  CODE_FONTS,
  FONT_SAMPLE,
  type Measure,
} from "../lib/fonts";
import type { PptxSettings } from "../lib/pptx-settings";
import type { Settings } from "../lib/settings";
import { AssistantPreferences } from "./AssistantPreferences";
import { GeneralPreferences } from "./GeneralPreferences";
import { McpPreferences } from "./McpPreferences";
import { PptxPreferences } from "./PptxPreferences";
import { Dialog } from "./Dialog";

type Tab = "general" | "pptx" | "mcp" | "assistant";

export type PreferencesProps = {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  fontSize: number;
  onChangeFontSize: (px: number) => void;
  vaultRoot: string | null;
  onChooseVault: () => void;
  /// MCP の設定をクリップボードへ（10-6）。写せたかを返す
  onCopyMcpConfig: () => Promise<boolean>;
  onChooseSlideTemplate: () => void;
  pptxSettings: PptxSettings;
  onChangePptxSettings: (patch: Partial<PptxSettings>) => void;
  onResetPptxSettings: () => void;
  /// 「デフォルトに戻す」。どの項目を既定へ戻すかは親が決める
  onReset: () => void;
  onClose: () => void;
  /// 開いているノートの本文を返す。開いていなければ null
  noteText: (() => string) | null;
  /// 履歴フォルダの大きさ（バイト）を聞く。失敗したら 0 として扱う
  historyUsage: () => Promise<number>;
  /// Ollama に入っているモデル名を聞く。失敗したら空
  installedModels: () => Promise<string[]>;
  /// 書き取りのショートカットが登録できなかった理由（無ければ null）
  captureShortcutError?: string | null;
};

export function PreferencesDialog(props: PreferencesProps) {
  // フォントの候補。**入っていないものは出さない**（要望 2026-09-04）。
  // Web からは端末のフォント一覧を列挙できないので、名前を挙げて 1 つずつ
  // 「その名前で組めるか」を幅で測る。**窓が開いている間だけ**測る（App が
  // 起動から抱えていた。19-4）
  const measureFont = useMemo<Measure | null>(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    return (spec) => {
      context.font = spec;
      return context.measureText(FONT_SAMPLE).width;
    };
  }, []);
  const bodyFontChoices = useMemo(
    () => availableFonts(BODY_FONTS, measureFont),
    [measureFont],
  );
  const codeFontChoices = useMemo(
    () => availableFonts(CODE_FONTS, measureFont),
    [measureFont],
  );
  const {
    settings,
    onChangeSettings,
    fontSize,
    onChangeFontSize,
    onReset,
    onClose,
    pptxSettings,
    onChangePptxSettings,
    historyUsage,
    installedModels,
  } = props;
  const [tab, setTab] = useState<Tab>("general");
  const [usage, setUsage] = useState<number | null>(null);
  // モデル欄の選択肢。**入っていない名前を打たせない**ためのもの
  // （名前違いの 404 で「返ってこない」ように見えた実機の事故から）
  const [models, setModels] = useState<string[]>([]);
  // キャンセルで戻すためのスナップショット（開いた瞬間の設定と文字サイズ）。
  // ダイアログは開いている間だけ mount されるので、初回描画 = 開いた瞬間
  // PowerPoint の設定も含める — 以前は含めず、キャンセルしても残っていた
  // （レビュー 2026-09-24 / 21-3）
  const snapshot = useRef({ settings, fontSize, pptxSettings });

  useEffect(() => {
    let alive = true;
    historyUsage()
      .then((bytes) => alive && setUsage(bytes))
      .catch(() => alive && setUsage(0));
    installedModels()
      .then((found) => alive && setModels(found))
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [historyUsage, installedModels]);

  function cancel() {
    onChangeSettings(snapshot.current.settings);
    onChangeFontSize(snapshot.current.fontSize);
    onChangePptxSettings(snapshot.current.pptxSettings);
    onClose();
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "一般" },
    { id: "pptx", label: "PowerPoint" },
    // 使う人の方が少ない。「一般」に混ぜると、要らない人の目にも毎回入る
    { id: "mcp", label: "MCP" },
    { id: "assistant", label: "アシスタント" },
  ];

  return (
    <Dialog
      title="環境設定"
      className="preferences"
      // 背景を押したら閉じる（**保持**。設定は触った瞬間に反映されるので、確認して
      // 外を押した人の変更を戻さない）。Esc だけキャンセル（21-5 で決めた）
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <div className="pref-tabs" role="tablist" aria-label="設定のページ">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "selected" : ""}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === "general" ? (
        <GeneralPreferences
          settings={settings}
          onChangeSettings={onChangeSettings}
          fontSize={fontSize}
          onChangeFontSize={onChangeFontSize}
          vaultRoot={props.vaultRoot}
          onChooseVault={props.onChooseVault}
          historyUsage={usage}
          bodyFontChoices={bodyFontChoices}
          codeFontChoices={codeFontChoices}
          captureShortcutError={props.captureShortcutError ?? null}
        />
      ) : tab === "mcp" ? (
        <McpPreferences onCopyMcpConfig={props.onCopyMcpConfig} />
      ) : tab === "pptx" ? (
        <PptxPreferences
          settings={settings}
          onChangeSettings={onChangeSettings}
          onChooseSlideTemplate={props.onChooseSlideTemplate}
          pptxSettings={pptxSettings}
          onChangePptxSettings={onChangePptxSettings}
          onResetPptxSettings={props.onResetPptxSettings}
          noteText={props.noteText}
        />
      ) : (
        <AssistantPreferences
          settings={settings}
          onChangeSettings={onChangeSettings}
          installedModels={models}
        />
      )}
      <div className="pref-actions">
        <button onClick={onReset}>デフォルトに戻す</button>
        <span className="pref-actions-right">
          <button onClick={cancel}>キャンセル</button>
          <button className="primary" onClick={onClose}>
            OK
          </button>
        </span>
      </div>
    </Dialog>
  );
}
