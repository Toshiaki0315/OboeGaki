// 環境設定「PowerPoint」タブの節（ADR-0046）。643 行の 1 部品を節ごとに分けた
// （19-4）。**設定を持つのは親のまま**（PptxPreferences → PreferencesDialog → App）。
// ここは表示と変更の通知だけ。同じ組の中の 1 項目を変えるのは `patch`

import { contrastVerdict } from "../lib/contrast";
import {
  hexColor,
  isThemeRef,
  themeRef,
  type PptxSettings,
} from "../lib/pptx-settings";
import type { Settings } from "../lib/settings";

/// 組（page / layout / font …）の中の項目を差し替える
export type PatchPptx = <G extends keyof PptxSettings>(
  group: G,
  part: Partial<PptxSettings[G]>,
) => void;

type SectionProps = { pptxSettings: PptxSettings; patch: PatchPptx };

/// スライドの分け方
export function PptxSplitSection({ pptxSettings, patch }: SectionProps) {
  return (
    <>
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
              patch("layout", {
                splitLevel: Number(event.currentTarget.value) as 1 | 2 | 3,
              })
            }
          >
            <option value="1">見出し 1（#）</option>
            <option value="2">見出し 2（##）</option>
            <option value="3">見出し 3（###）</option>
          </select>
        </label>
      </div>
    </>
  );
}

/// 1 枚に載せる量
export function PptxDensitySection({ pptxSettings, patch }: SectionProps) {
  return (
    <>
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
              patch("layout", {
                density: event.currentTarget
                  .value as PptxSettings["layout"]["density"],
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
                patch("layout", {
                  maxBulletItems: Number(event.currentTarget.value),
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
              patch("layout", { continuationSuffix: event.currentTarget.value })
            }
          />
        </label>
      </div>
    </>
  );
}

/// 見た目
export function PptxThemeSection({
  pptxSettings,
  patch,
  settings,
  onChangeSettings,
  onChooseSlideTemplate,
  onChangePptxSettings,
}: SectionProps & {
  settings: Settings;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onChooseSlideTemplate: () => void;
  /// 色の入れ子（theme.palette）は 2 段なので生の変更で
  onChangePptxSettings: (patch: Partial<PptxSettings>) => void;
}) {
  return (
    <>
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
              patch("font", { jp: event.currentTarget.value })
            }
          />
        </label>
        <label>
          <span>コードの書体</span>
          <input
            value={pptxSettings.font.mono}
            onChange={(event) =>
              patch("font", { mono: event.currentTarget.value })
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
    </>
  );
}

/// フッタ
export function PptxFooterSection({ pptxSettings, patch }: SectionProps) {
  return (
    <>
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
                patch("footer", { pageNumber: event.currentTarget.checked })
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
              patch("footer", { text: event.currentTarget.value })
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
                patch("footer", { showDate: event.currentTarget.checked })
              }
            />
            書き出した日を入れる
          </span>
        </label>
      </div>
    </>
  );
}

/// 発表者ノート
export function PptxNotesSection({
  pptxSettings,
  onKeepOriginal,
}: { pptxSettings: PptxSettings } & {
  onKeepOriginal: (keep: boolean) => void;
}) {
  return (
    <>
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
              onChange={(event) => onKeepOriginal(event.currentTarget.checked)}
            />
            発表者ノートに残す
          </span>
        </label>
      </div>
    </>
  );
}

/// 書き出す前のチェック
export function PptxLintSection({ pptxSettings, patch }: SectionProps) {
  return (
    <>
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
              patch("advanced", {
                lintLevel: event.currentTarget
                  .value as PptxSettings["advanced"]["lintLevel"],
              })
            }
          >
            <option value="off">調べない</option>
            <option value="warn">知らせる（書き出しは続ける）</option>
            <option value="strict">書き出しを止める</option>
          </select>
        </label>
      </div>
    </>
  );
}

/// コードと画像
export function PptxDecorationSection({ pptxSettings, patch }: SectionProps) {
  return (
    <>
      <h3 className="pref-section">コードと画像</h3>
      <div className="preferences-fields">
        <label>
          <span>言語名</span>
          <span className="pref-check">
            <input
              type="checkbox"
              checked={pptxSettings.decoration.codeLanguageLabel}
              onChange={(event) =>
                patch("decoration", {
                  codeLanguageLabel: event.currentTarget.checked,
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
                patch("decoration", {
                  imageCaption: event.currentTarget.checked,
                })
              }
            />
            画像の下に説明（`![説明](…)`）を出す
          </span>
        </label>
      </div>
    </>
  );
}
