// 環境設定「PowerPoint」タブ（ADR-0046 / TASKS 第 8 群）。書き出し設定の
// つまみと下絵。設定そのものは親（App）が持ち、ここは表示と変更の通知だけ。
// **下絵の状態（どの見本・何枚目・組み直し待ち）はこのタブで閉じる。**

import { useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { APP_NAME } from "../lib/app-name";
import { contrastVerdict } from "../lib/contrast";
import {
  hexColor,
  isThemeRef,
  MAX_PAGE_IN,
  MIN_PAGE_IN,
  themeRef,
  type PptxSettings,
} from "../lib/pptx-settings";
import type { Settings } from "../lib/settings";
import { slideMetrics } from "../lib/slide-grid";
import { overflowingSlides } from "../lib/slide-lint";
import { previewOf, SAMPLE_DECKS } from "../lib/slide-preview";
import { splitForDensity } from "../lib/slide-split";
import { splitDeck } from "../lib/slides";
import { SlidePreview } from "./SlidePreview";

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
    const deck = splitForDensity(
      splitDeck(text, pptxSettings.layout.splitLevel),
      pptxSettings,
      metrics,
    );
    return overflowingSlides(deck, metrics);
  }, [noteText, pptxSettings]);

  /// 「載らなかった本文を残す」の切り替え（CFG-60 / CFG-62）。
  ///
  /// **切るときだけ確認する。** 既定の ON を強く保つための一拍で、
  /// 入れ直すときは黙って入れる。
  async function changeKeepOriginal(keep: boolean) {
    if (!keep) {
      const ok = await confirm(
        "「要点のみ」で書き出したとき、スライドに載らなかった本文が" +
          "発表者ノートにも残らなくなります。\n" +
          "（ノートの本文そのものは消えません）",
        { title: APP_NAME, kind: "warning" },
      );
      if (!ok) return;
    }
    onChangePptxSettings({
      notes: { ...pptxSettings.notes, keepOriginalText: keep },
    });
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
              onChangePptxSettings({
                page: {
                  ...pptxSettings.page,
                  preset: event.currentTarget
                    .value as PptxSettings["page"]["preset"],
                },
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
                  onChangePptxSettings({
                    page: {
                      ...pptxSettings.page,
                      customWidthIn: Number(event.currentTarget.value),
                    },
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
                  onChangePptxSettings({
                    page: {
                      ...pptxSettings.page,
                      customHeightIn: Number(event.currentTarget.value),
                    },
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
              onChangePptxSettings({
                layout: {
                  ...pptxSettings.layout,
                  marginScale: event.currentTarget
                    .value as PptxSettings["layout"]["marginScale"],
                },
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
              onChangePptxSettings({
                font: {
                  ...pptxSettings.font,
                  scale: event.currentTarget
                    .value as PptxSettings["font"]["scale"],
                },
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
      <h3 className="pref-section">スライドの分け方</h3>
      <p className="pref-note">
        どの見出しで 1 枚に分けるか。浅い見出しは扉、深い見出しは
        枚の中の小見出しになります。
      </p>
      <div className="preferences-fields">
        <label>
          <span>分ける見出し</span>
          <select
            value={String(pptxSettings.layout.splitLevel)}
            onChange={(event) =>
              onChangePptxSettings({
                layout: {
                  ...pptxSettings.layout,
                  splitLevel: Number(event.currentTarget.value) as 1 | 2 | 3,
                },
              })
            }
          >
            <option value="1">見出し 1（#）</option>
            <option value="2">見出し 2（##）</option>
            <option value="3">見出し 3（###）</option>
          </select>
        </label>
      </div>
      <h3 className="pref-section">1 枚に載せる量</h3>
      <p className="pref-note">
        収まらないぶんは**次の枚へ送ります**（字を縮めたり、
        書いた文を削ったりはしません）。
      </p>
      <div className="preferences-fields">
        <label>
          <span>載せ方</span>
          <select
            value={pptxSettings.layout.density}
            onChange={(event) =>
              onChangePptxSettings({
                layout: {
                  ...pptxSettings.layout,
                  density: event.currentTarget
                    .value as PptxSettings["layout"]["density"],
                },
              })
            }
          >
            <option value="full">詳しく</option>
            <option value="normal">標準</option>
            <option value="sparse">要点のみ</option>
          </select>
        </label>
        <p className="pref-note">
          {pptxSettings.layout.density === "sparse"
            ? "要点のみ — スライドは短く、本文は発表者ノートに入ります"
            : pptxSettings.layout.density === "full"
              ? "詳しく — 書いたものをそのまま載せます（溢れたら次の枚へ）"
              : "標準 — 収まらないときだけ次の枚へ送ります"}
        </p>
        <label>
          <span>箇条書きの上限</span>
          <span className="pref-check">
            <input
              type="range"
              min={3}
              max={10}
              value={pptxSettings.layout.maxBulletItems}
              onChange={(event) =>
                onChangePptxSettings({
                  layout: {
                    ...pptxSettings.layout,
                    maxBulletItems: Number(event.currentTarget.value),
                  },
                })
              }
            />
            1 枚に {pptxSettings.layout.maxBulletItems} 項目まで
          </span>
        </label>
        <label>
          <span>続きの枚の印</span>
          <input
            value={pptxSettings.layout.continuationSuffix}
            onChange={(event) =>
              onChangePptxSettings({
                layout: {
                  ...pptxSettings.layout,
                  continuationSuffix: event.currentTarget.value,
                },
              })
            }
          />
        </label>
      </div>
      <h3 className="pref-section">見た目</h3>
      <p className="pref-note">
        色と書体。**ノートの front matter に書いてあれば
        そちらが勝ちます**（そのノートだけ変えたいとき）。
      </p>
      <div className="preferences-fields">
        <label>
          <span>見出しの色</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={isThemeRef(pptxSettings.theme.palette.accent)}
              onChange={(event) =>
                onChangePptxSettings({
                  theme: {
                    ...pptxSettings.theme,
                    palette: {
                      ...pptxSettings.theme.palette,
                      accent: event.currentTarget.checked
                        ? themeRef("accent1")
                        : { hex: "1E2761" },
                    },
                  },
                })
              }
            />
            テーマに従う（PowerPoint 側で替えると一緒に変わる）
          </span>
        </label>
        {!isThemeRef(pptxSettings.theme.palette.accent) && (
          <label>
            <span>色を選ぶ</span>
            <input
              type="color"
              value={`#${(pptxSettings.theme.palette.accent as { hex: string }).hex}`}
              onChange={(event) => {
                const picked = hexColor(event.currentTarget.value);
                if (!picked) return;
                onChangePptxSettings({
                  theme: {
                    ...pptxSettings.theme,
                    palette: {
                      ...pptxSettings.theme.palette,
                      accent: picked,
                    },
                  },
                });
              }}
            />
          </label>
        )}
        {!isThemeRef(pptxSettings.theme.palette.accent) &&
          (() => {
            // **白い紙に置いたときの読みやすさ**（CFG-19）。
            // 白は「表の見出しの字の色」でもあるので、
            // この 1 組が両方の見え方をあらわす
            const found = contrastVerdict(
              (
                pptxSettings.theme.palette.accent as {
                  hex: string;
                }
              ).hex,
              "FFFFFF",
            );
            return (
              <p className="pref-note">
                白い背景での見えかた: {found.ratio.toFixed(1)}:1
                {found.body === "warn"
                  ? found.heading === "warn"
                    ? "（薄すぎます。大きな字でも読みにくい色です）"
                    : "（見出しには足りますが、本文には薄い色です）"
                  : "（読みやすい色です）"}
              </p>
            );
          })()}
        <label>
          <span>本文の書体</span>
          <input
            value={pptxSettings.font.jp}
            placeholder="選んでいません（テンプレートに従う）"
            onChange={(event) =>
              onChangePptxSettings({
                font: {
                  ...pptxSettings.font,
                  jp: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <label>
          <span>コードの書体</span>
          <input
            value={pptxSettings.font.mono}
            onChange={(event) =>
              onChangePptxSettings({
                font: {
                  ...pptxSettings.font,
                  mono: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <label>
          <span>テンプレート</span>
          <span className="pref-vault-row">
            <input
              value={settings.slideTemplate}
              readOnly
              placeholder="選んでいません（既定の見た目）"
            />
            <button onClick={() => onChooseSlideTemplate()}>選ぶ…</button>
            {settings.slideTemplate && (
              <button onClick={() => onChangeSettings({ slideTemplate: "" })}>
                外す
              </button>
            )}
          </span>
        </label>
      </div>
      <h3 className="pref-section">フッタ</h3>
      <p className="pref-note">
        どの枚にも同じように入る帯。空にすると、ノートの題名が 入ります。
      </p>
      <div className="preferences-fields">
        <label>
          <span>ページ番号</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.footer.pageNumber}
              onChange={(event) =>
                onChangePptxSettings({
                  footer: {
                    ...pptxSettings.footer,
                    pageNumber: event.currentTarget.checked,
                  },
                })
              }
            />
            右下にページ番号を入れる
          </span>
        </label>
        <label>
          <span>フッタの字</span>
          <input
            value={pptxSettings.footer.text}
            placeholder="空ならノートの題名"
            onChange={(event) =>
              onChangePptxSettings({
                footer: {
                  ...pptxSettings.footer,
                  text: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <label>
          <span>日付</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.footer.showDate}
              onChange={(event) =>
                onChangePptxSettings({
                  footer: {
                    ...pptxSettings.footer,
                    showDate: event.currentTarget.checked,
                  },
                })
              }
            />
            書き出した日を入れる
          </span>
        </label>
      </div>
      <h3 className="pref-section">発表者ノート</h3>
      <p className="pref-note">
        スライドに載らなかった本文の行き先。ノートの本文
        （`.md`）は、どちらにしても変わりません。
      </p>
      <div className="preferences-fields">
        <label>
          <span>載らなかった本文</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.notes.keepOriginalText}
              onChange={(event) =>
                void changeKeepOriginal(event.currentTarget.checked)
              }
            />
            発表者ノートに残す
          </span>
        </label>
      </div>
      <h3 className="pref-section">書き出す前のチェック</h3>
      <p className="pref-note">
        文字が枠に収まるかを見ます。**当たりをつけるだけ**の
        見積もりなので、多めに知らせます。
      </p>
      <div className="preferences-fields">
        <label>
          <span>収まらないとき</span>
          <select
            value={pptxSettings.advanced.lintLevel}
            onChange={(event) =>
              onChangePptxSettings({
                advanced: {
                  ...pptxSettings.advanced,
                  lintLevel: event.currentTarget
                    .value as PptxSettings["advanced"]["lintLevel"],
                },
              })
            }
          >
            <option value="off">調べない</option>
            <option value="warn">知らせる（書き出しは続ける）</option>
            <option value="strict">書き出しを止める</option>
          </select>
        </label>
      </div>
      <h3 className="pref-section">コードと画像</h3>
      <div className="preferences-fields">
        <label>
          <span>言語名</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.decoration.codeLanguageLabel}
              onChange={(event) =>
                onChangePptxSettings({
                  decoration: {
                    ...pptxSettings.decoration,
                    codeLanguageLabel: event.currentTarget.checked,
                  },
                })
              }
            />
            コードの上に言語名を小さく出す
          </span>
        </label>
        <label>
          <span>画像の説明</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.decoration.imageCaption}
              onChange={(event) =>
                onChangePptxSettings({
                  decoration: {
                    ...pptxSettings.decoration,
                    imageCaption: event.currentTarget.checked,
                  },
                })
              }
            />
            画像の下に説明（`![説明](…)`）を出す
          </span>
        </label>
      </div>
      <div className="pref-actions">
        <button onClick={onResetPptxSettings}>
          PowerPoint の設定を既定に戻す
        </button>
      </div>
    </div>
  );
}
