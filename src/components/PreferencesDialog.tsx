// 環境設定ダイアログ（TASKS 3-9）の殻。タブの切り替え・キャンセルで戻す
// ためのスナップショット・履歴の使用量とモデル一覧の取り寄せは、開いて
// いる間だけ要るものなので**ここで閉じる**。設定そのものは親（App）が持つ。

import { useEffect, useRef, useState } from "react";
import type { FontChoice } from "../lib/fonts";
import type { PptxSettings } from "../lib/pptx-settings";
import type { Settings } from "../lib/settings";
import { AssistantPreferences } from "./AssistantPreferences";
import { GeneralPreferences } from "./GeneralPreferences";
import { PptxPreferences } from "./PptxPreferences";

type Tab = "general" | "pptx" | "assistant";

export type PreferencesProps = {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  fontSize: number;
  onChangeFontSize: (px: number) => void;
  vaultRoot: string | null;
  onChooseVault: () => void;
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
  bodyFontChoices: readonly FontChoice[];
  codeFontChoices: readonly FontChoice[];
};

export function PreferencesDialog(props: PreferencesProps) {
  const {
    settings,
    onChangeSettings,
    fontSize,
    onChangeFontSize,
    onReset,
    onClose,
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
  const snapshot = useRef({ settings, fontSize });

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
    onClose();
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "一般" },
    { id: "pptx", label: "PowerPoint" },
    { id: "assistant", label: "アシスタント" },
  ];

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette preferences"
        role="dialog"
        aria-label="環境設定"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">環境設定</header>
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
            bodyFontChoices={props.bodyFontChoices}
            codeFontChoices={props.codeFontChoices}
          />
        ) : tab === "pptx" ? (
          <PptxPreferences
            settings={settings}
            onChangeSettings={onChangeSettings}
            onChooseSlideTemplate={props.onChooseSlideTemplate}
            pptxSettings={props.pptxSettings}
            onChangePptxSettings={props.onChangePptxSettings}
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
      </div>
    </div>
  );
}
