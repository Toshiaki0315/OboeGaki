// 環境設定「PowerPoint」タブ（ADR-0046 / TASKS 第 8 群）。書き出し設定の
// つまみと下絵。設定そのものは親（App）が持ち、ここは表示と変更の通知だけ。
// **下絵の状態（どの見本・何枚目・組み直し待ち）はこのタブで閉じる。**

import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "../lib/ipc";
import { APP_NAME } from "../lib/app-name";
import {
  MAX_PAGE_IN,
  MIN_PAGE_IN,
  type PptxSettings,
} from "../lib/pptx-settings";
import type { Settings } from "../lib/settings";
import { slideMetrics } from "../lib/slide-grid";
import { overflowingSlides } from "../lib/slide-lint";
import { previewOf, SAMPLE_DECKS } from "../lib/slide-preview";
import { SlidePreview } from "./SlidePreview";
import {
  PptxDecorationSection,
  PptxDensitySection,
  PptxFooterSection,
  PptxLintSection,
  PptxNotesSection,
  PptxSplitSection,
  PptxThemeSection,
  type PatchPptx,
} from "./PptxSections";
import { buildDeck } from "../lib/slide-split";

export type PptxPreferencesProps = {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onChooseSlideTemplate: () => void;
  pptxSettings: PptxSettings;
  onChangePptxSettings: (patch: Partial<PptxSettings>) => void;
  onResetPptxSettings: () => void;
  /// 開いているノートの本文を返す。開いていなければ null
  noteText: (() => string) | null;
};

export function PptxPreferences({
  settings,
  onChangeSettings,
  onChooseSlideTemplate,
  pptxSettings,
  onChangePptxSettings,
  onResetPptxSettings,
  noteText,
}: PptxPreferencesProps) {
  /// 組の中の 1 項目を差し替える（20 か所で `{ group: { ...pptxSettings.group, k } }`
  /// を書いていた。19-4）
  const patch: PatchPptx = (group, part) =>
    onChangePptxSettings({
      [group]: Object.assign({}, pptxSettings[group], part),
    } as Partial<PptxSettings>);
  // プレビュー（8-6）。見本を選ぶ／編集中のノートで見る（PV-02 / PV-03）
  const [previewSample, setPreviewSample] = useState(1);
  const [previewOwn, setPreviewOwn] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  /// 200ms 置いてから組み直す（PV-04。つまみを動かすたびに組まない）
  const [previewSettings, setPreviewSettings] = useState<PptxSettings | null>(
    null,
  );

  /// 用紙や字の大きさを変えたときの見直し（GR-05）。**今のノートで測る** —
  /// 設定を触った瞬間に「収まらなくなった」が分かるほうが、書き出してから
  /// 気づくより早い。開いていなければ何も言わない。
  const pptxOverflow = useMemo(() => {
    if (!noteText) return null;
    const text = noteText();
    if (!text.trim()) return null;
    const metrics = slideMetrics(pptxSettings);
    const deck = buildDeck(text, pptxSettings, metrics);
    return overflowingSlides(deck, metrics);
  }, [noteText, pptxSettings]);

  /// 「載らなかった本文を残す」の切り替え（CFG-60 / CFG-62）。
  ///
  /// **切るときだけ確認する。** 既定の ON を強く保つための一拍で、
  /// 入れ直すときは黙って入れる。
  async function changeKeepOriginal(keep: boolean) {
    if (!keep) {
      const ok = await confirmDialog(
        "「要点のみ」で書き出したとき、スライドに載らなかった本文が" +
          "発表者ノートにも残らなくなります。\n" +
          "（ノートの本文そのものは消えません）",
        { title: APP_NAME, kind: "warning" },
      );
      if (!ok) return;
    }
    patch("notes", { keepOriginalText: keep });
  }

  useEffect(() => {
    const timer = setTimeout(() => setPreviewSettings(pptxSettings), 200);
    return () => clearTimeout(timer);
  }, [pptxSettings]);

  const preview = useMemo(() => {
    if (!previewSettings) return null;
    const source = previewOwn
      ? (noteText?.() ?? "")
      : SAMPLE_DECKS[previewSample].markdown;
    if (!source.trim()) return null;
    return previewOf(source, previewSettings);
  }, [previewSettings, previewOwn, previewSample, noteText]);

  return (
    <div className="pref-page">
      <h3 className="pref-section">用紙</h3>
      <p className="pref-note">
        スライドの大きさ。変えると余白と字の大きさも一緒に 組み直します。
      </p>
      <div className="preferences-fields">
        <label>
          <span>大きさ</span>
          <select
            value={pptxSettings.page.preset}
            onChange={(event) =>
              patch("page", {
                preset: event.currentTarget
                  .value as PptxSettings["page"]["preset"],
              })
            }
          >
            <option value="16:9">16:9（横）</option>
            <option value="4:3">4:3（横・昔の投影機）</option>
            <option value="16:10">16:10（横）</option>
            <option value="a4-landscape">A4（横・配布用）</option>
            <option value="a4-portrait">A4（縦）</option>
            <option value="9:16">9:16（縦・スマホ）</option>
            <option value="custom">自分で決める</option>
          </select>
        </label>
        {pptxSettings.page.preset === "custom" && (
          <label>
            <span>幅と高さ（インチ）</span>
            <span className="pref-vault-row">
              <input
                type="number"
                min={MIN_PAGE_IN}
                max={MAX_PAGE_IN}
                step={0.1}
                value={pptxSettings.page.customWidthIn}
                onChange={(event) =>
                  patch("page", {
                    customWidthIn: Number(event.currentTarget.value),
                  })
                }
              />
              <input
                type="number"
                min={MIN_PAGE_IN}
                max={MAX_PAGE_IN}
                step={0.1}
                value={pptxSettings.page.customHeightIn}
                onChange={(event) =>
                  patch("page", {
                    customHeightIn: Number(event.currentTarget.value),
                  })
                }
              />
            </span>
          </label>
        )}
        <label>
          <span>余白</span>
          <select
            value={pptxSettings.layout.marginScale}
            onChange={(event) =>
              patch("layout", {
                marginScale: event.currentTarget
                  .value as PptxSettings["layout"]["marginScale"],
              })
            }
          >
            <option value="compact">狭い</option>
            <option value="normal">標準</option>
            <option value="wide">広い</option>
          </select>
        </label>
        <label>
          <span>字の大きさ</span>
          <select
            value={pptxSettings.font.scale}
            onChange={(event) =>
              patch("font", {
                scale: event.currentTarget
                  .value as PptxSettings["font"]["scale"],
              })
            }
          >
            <option value="small">小</option>
            <option value="normal">標準</option>
            <option value="large">大</option>
          </select>
        </label>
      </div>
      {preview !== null && preview.pages.length > 0 && (
        <div className="preview-panel">
          <div className="preview-tabs">
            {SAMPLE_DECKS.map((sample, index) => (
              <button
                key={sample.name}
                className={
                  !previewOwn && index === previewSample ? "selected" : ""
                }
                onClick={() => {
                  setPreviewOwn(false);
                  setPreviewSample(index);
                  setPreviewPage(0);
                }}
              >
                {sample.name}
              </button>
            ))}
            <button
              className={previewOwn ? "selected" : ""}
              disabled={noteText === null}
              title="編集中のノートの先頭 5 枚"
              onClick={() => {
                setPreviewOwn(true);
                setPreviewPage(0);
              }}
            >
              このノート
            </button>
          </div>
          <SlidePreview
            page={
              preview.pages[Math.min(previewPage, preview.pages.length - 1)]
            }
            view={preview}
          />
          <div className="preview-pager">
            <button
              disabled={previewPage <= 0}
              onClick={() => setPreviewPage((at) => at - 1)}
            >
              ◀
            </button>
            <span>
              {Math.min(previewPage, preview.pages.length - 1) + 1} /{" "}
              {preview.pages.length}
            </span>
            <button
              disabled={previewPage >= preview.pages.length - 1}
              onClick={() => setPreviewPage((at) => at + 1)}
            >
              ▶
            </button>
          </div>
          <p className="pref-note">
            形と収まり具合の目安です。**字の幅は見積もり**で、
            本物の書体で組むのは PowerPoint 側です。
          </p>
        </div>
      )}
      {pptxOverflow !== null && pptxOverflow.length > 0 && (
        <p className="pref-note pref-warn">
          いまのノートは <b>{pptxOverflow.length} 枚</b>
          で文字が収まらないかもしれません（
          {pptxOverflow
            .map((slide) => slide.title)
            .slice(0, 3)
            .join("・")}
          {pptxOverflow.length > 3 ? " ほか" : ""}
          ）。用紙を大きくするか、字を小さくすると収まります。
        </p>
      )}
      <PptxSplitSection pptxSettings={pptxSettings} patch={patch} />
      <PptxDensitySection pptxSettings={pptxSettings} patch={patch} />
      <PptxThemeSection
        pptxSettings={pptxSettings}
        patch={patch}
        settings={settings}
        onChangeSettings={onChangeSettings}
        onChooseSlideTemplate={onChooseSlideTemplate}
        onChangePptxSettings={onChangePptxSettings}
      />
      <PptxFooterSection pptxSettings={pptxSettings} patch={patch} />
      <PptxNotesSection
        pptxSettings={pptxSettings}
        onKeepOriginal={(keep) => void changeKeepOriginal(keep)}
      />
      <PptxLintSection pptxSettings={pptxSettings} patch={patch} />
      <PptxDecorationSection pptxSettings={pptxSettings} patch={patch} />
      <div className="pref-actions">
        <button onClick={onResetPptxSettings}>
          PowerPoint の設定を既定に戻す
        </button>
      </div>
    </div>
  );
}
