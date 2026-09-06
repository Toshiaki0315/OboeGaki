// 環境設定「一般」タブ（TASKS 3-9）。本文の見え方・ウィンドウ・ノートの
// 置き場所。設定そのものは親（App）が持ち、ここは表示と変更の通知だけ。

import type { FontChoice } from "../lib/fonts";
import { MAX_FONT_PX, MIN_FONT_PX } from "../lib/font-size";
import {
  CONTENT_WIDTHS,
  HISTORY_CHOICES,
  LINE_SPACINGS,
  MAX_TRASH_DAYS,
  MIN_TRASH_DAYS,
  TAB_WIDTHS,
  THEMES,
  type ContentWidth,
  type LineSpacing,
  type Settings,
  type Theme,
} from "../lib/settings";

const THEME_LABELS: Record<Theme, string> = {
  system: "システムに合わせる",
  light: "ライト",
  dark: "ダーク",
};

const SPACING_LABELS: Record<LineSpacing, string> = {
  tight: "詰めて",
  normal: "ふつう",
  relaxed: "ゆったり",
};

const WIDTH_LABELS: Record<ContentWidth, string> = {
  standard: "標準",
  wide: "広め",
  full: "最大（ウィンドウ幅）",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export type GeneralPreferencesProps = {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  fontSize: number;
  onChangeFontSize: (px: number) => void;
  vaultRoot: string | null;
  onChooseVault: () => void;
  /// 履歴フォルダの大きさ（バイト）。まだ数えていなければ null
  historyUsage: number | null;
  bodyFontChoices: readonly FontChoice[];
  codeFontChoices: readonly FontChoice[];
};

export function GeneralPreferences({
  settings,
  onChangeSettings,
  fontSize,
  onChangeFontSize,
  vaultRoot,
  onChooseVault,
  historyUsage,
  bodyFontChoices,
  codeFontChoices,
}: GeneralPreferencesProps) {
  return (
    <div className="pref-page">
      <h3 className="pref-section">本文の見え方</h3>
      <p className="pref-note">
        エディタに出る文字の形と幅。開いているノートにすぐ反映されます。
      </p>
      <div className="preferences-fields">
        <label>
          <span>本文フォント</span>
          <input
            list="body-fonts"
            value={settings.bodyFont}
            placeholder="システムの既定"
            onChange={(event) =>
              onChangeSettings({
                bodyFont: event.currentTarget.value,
              })
            }
          />
          <datalist id="body-fonts">
            {bodyFontChoices.map((font) => (
              <option
                key={font.family}
                value={font.family}
                label={font.label}
              />
            ))}
          </datalist>
        </label>
        <label>
          <span>文字サイズ</span>
          <span className="pref-unit-row">
            <input
              type="number"
              min={MIN_FONT_PX}
              max={MAX_FONT_PX}
              value={fontSize}
              onChange={(event) =>
                onChangeFontSize(Number(event.currentTarget.value))
              }
            />
            <span className="pref-unit">px</span>
          </span>
        </label>
        <label>
          {/* 等幅に限らない（要望 2026-09-04）。ここが効くのは
            コード・数式・Mermaid のソースで、桁を空白で
            揃えるのをやめた（ADR-0044）ので等幅である必要は
            もう無い。呼び名も中身に合わせる */}
          <span>コード・数式のフォント</span>
          <input
            list="mono-fonts"
            value={settings.monoFont}
            placeholder="既定の等幅"
            onChange={(event) =>
              onChangeSettings({
                monoFont: event.currentTarget.value,
              })
            }
          />
          <datalist id="mono-fonts">
            {codeFontChoices.map((font) => (
              <option
                key={font.family}
                value={font.family}
                label={font.label}
              />
            ))}
          </datalist>
        </label>
        <label>
          <span>本文の幅</span>
          <select
            value={settings.contentWidth}
            onChange={(event) =>
              onChangeSettings({
                contentWidth: event.currentTarget.value as ContentWidth,
              })
            }
          >
            {CONTENT_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {WIDTH_LABELS[width]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>タブ幅</span>
          <span className="pref-unit-row">
            <select
              value={settings.tabWidth}
              onChange={(event) =>
                onChangeSettings({
                  tabWidth: Number(event.currentTarget.value),
                })
              }
            >
              {TAB_WIDTHS.map((width) => (
                <option key={width} value={width}>
                  {width}
                </option>
              ))}
            </select>
            <span className="pref-unit">文字</span>
          </span>
        </label>
        <label>
          <span>字下げ</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={settings.indentedCode}
              onChange={(event) =>
                onChangeSettings({
                  indentedCode: event.currentTarget.checked,
                })
              }
            />
            4 文字の字下げでコードブロックとする
          </span>
        </label>
        <label>
          <span>行番号</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={settings.lineNumbers}
              onChange={(event) =>
                onChangeSettings({
                  lineNumbers: event.currentTarget.checked,
                })
              }
            />
            本文の左に行番号を出す
          </span>
        </label>
      </div>
      <h3 className="pref-section">ウィンドウ</h3>
      <p className="pref-note">
        アプリ全体の配色と、一覧やサイドバーの詰まり具合。
      </p>
      <div className="preferences-fields">
        <label>
          <span>テーマ</span>
          <select
            value={settings.theme}
            onChange={(event) =>
              onChangeSettings({
                theme: event.currentTarget.value as Theme,
              })
            }
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>行間</span>
          <select
            value={settings.lineSpacing}
            onChange={(event) =>
              onChangeSettings({
                lineSpacing: event.currentTarget.value as LineSpacing,
              })
            }
          >
            {LINE_SPACINGS.map((spacing) => (
              <option key={spacing} value={spacing}>
                {SPACING_LABELS[spacing]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="pref-section">ノートの置き場所</h3>
      <p className="pref-note">
        .md ファイルを読み書きするフォルダ。変えても中のファイルは移動しません。
      </p>
      <div className="preferences-fields">
        <label>
          <span>保管フォルダ</span>
          <span className="pref-vault-row">
            <input value={vaultRoot ?? ""} readOnly />
            <button onClick={() => onChooseVault()}>変更…</button>
          </span>
        </label>
        <label>
          <span>ゴミ箱の保持</span>
          <span className="pref-unit-row">
            <input
              type="number"
              min={MIN_TRASH_DAYS}
              max={MAX_TRASH_DAYS}
              value={settings.trashDays}
              onChange={(event) =>
                onChangeSettings({
                  trashDays: Number(event.currentTarget.value),
                })
              }
            />
            <span className="pref-unit">日</span>
          </span>
        </label>
        <label>
          <span>履歴を残す間隔</span>
          <select
            value={settings.historyMinutes}
            onChange={(event) =>
              onChangeSettings({
                historyMinutes: Number(event.currentTarget.value),
              })
            }
          >
            {HISTORY_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "なし" : `${minutes} 分`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>履歴の使用量</span>
          <span className="pref-static">
            {historyUsage === null ? "計算中…" : formatBytes(historyUsage)}
          </span>
        </label>
      </div>
    </div>
  );
}
