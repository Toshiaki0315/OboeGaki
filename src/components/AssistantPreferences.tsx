// 環境設定「アシスタント」タブ。Ollama の繋ぎ方・外のサービス・文字の
// 読み取り。設定そのものは親（App）が持ち、ここは表示と変更の通知だけ。

import {
  CONTEXT_CHOICES,
  KEEP_ALIVE_CHOICES,
  type Settings,
} from "../lib/settings";

export type AssistantPreferencesProps = {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  /// Ollama に入っているモデル名。まだ聞けていなければ空
  installedModels: readonly string[];
};

export function AssistantPreferences({
  settings,
  onChangeSettings,
  installedModels,
}: AssistantPreferencesProps) {
  return (
    <div className="pref-page">
      <h3 className="pref-section">アシスタント</h3>
      {/* **数字や記号で説明しない**（要望 2026-09-04）。
        127.0.0.1 と書いても伝わらない。約束の中身
        （外へ出ない）は変えず、言い方だけ変える */}
      {/* **一番上に置く**（要望 2026-09-04）。切ってあるときは
        以下を丸ごと押せなくし、Cmd+6 でも出さない */}
      <label className="pref-check pref-toggle">
        <input
          type="checkbox"
          checked={settings.assistantEnabled}
          onChange={(event) =>
            onChangeSettings({
              assistantEnabled: event.currentTarget.checked,
            })
          }
        />
        AI アシスタントを使う
      </label>
      <p className="pref-note">
        Ollama に繋いで、要約やレビューを頼みます。やり取りは
        このパソコンの中だけで行われ、ノートは外へ出ません。
      </p>
      {/* **まとめて押せなくする。** 1 つずつ disabled を付けると、
        あとで足した欄に付け忘れる */}
      <fieldset
        className="preferences-fields"
        disabled={!settings.assistantEnabled}
      >
        <label>
          <span>モデル</span>
          <span className="pref-unit-row">
            <input
              value={settings.llmModel}
              placeholder="gemma3:4b"
              list="llm-model-choices"
              onChange={(event) =>
                onChangeSettings({
                  llmModel: event.currentTarget.value,
                })
              }
            />
            <datalist id="llm-model-choices">
              {installedModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {installedModels.length > 0 &&
            !installedModels.includes(settings.llmModel) ? (
              <span className="pref-unit">（Ollama に入っていません）</span>
            ) : null}
          </span>
        </label>
        <label>
          <span>ポート</span>
          <span className="pref-unit-row">
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.llmPort}
              onChange={(event) =>
                onChangeSettings({
                  llmPort: Number(event.currentTarget.value),
                })
              }
            />
            <span className="pref-unit">（このパソコンの中だけ）</span>
          </span>
        </label>
        <label>
          <span>一度に渡す量</span>
          <select
            value={settings.llmContext}
            onChange={(event) =>
              onChangeSettings({
                llmContext: Number(event.currentTarget.value),
              })
            }
          >
            {CONTEXT_CHOICES.map((tokens) => (
              <option key={tokens} value={tokens}>
                {tokens / 1024}k トークン
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>応答待ち時間</span>
          <span className="pref-unit-row">
            <input
              type="number"
              min={1}
              max={60}
              value={settings.llmTimeoutMinutes}
              onChange={(event) =>
                onChangeSettings({
                  llmTimeoutMinutes: Number(event.currentTarget.value),
                })
              }
            />
            <span className="pref-unit">分</span>
          </span>
        </label>
        <label>
          <span>モデルを残す時間</span>
          <select
            value={settings.llmKeepAlive}
            onChange={(event) =>
              onChangeSettings({
                llmKeepAlive: event.currentTarget.value,
              })
            }
          >
            {KEEP_ALIVE_CHOICES.map((value) => (
              <option key={value} value={value}>
                {value === "0" ? "すぐ降ろす" : value.replace("m", " 分")}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <h3 className="pref-section">外のサービス</h3>
      <p className="pref-note">
        本文を右クリックして選んだところを、外の生成 AI や Google
        へ渡せます。**渡すのは選んだところだけ**で、 押したときしか出ません。
      </p>
      <div className="preferences-fields">
        <label>
          <span>渡す前の確認</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={settings.confirmHandoff}
              onChange={(event) =>
                onChangeSettings({
                  confirmHandoff: event.currentTarget.checked,
                })
              }
            />
            生成AIにデータを渡すときは確認する
          </span>
        </label>
      </div>
      <h3 className="pref-section">画像とPDF</h3>
      <p className="pref-note">
        取り込んだ画像や PDF から、絵の中の文字を起こすときに使うもの。
      </p>
      <div className="preferences-fields">
        <label>
          <span>文字の読み取り</span>
          <select value="mac" onChange={() => {}}>
            <option value="mac">macOS（デフォルト）</option>
          </select>
        </label>
      </div>
    </div>
  );
}
