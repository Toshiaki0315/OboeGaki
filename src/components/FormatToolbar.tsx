// 書式ツールバー（B-1）。ショートカットを覚えていなくても押せるようにする。
// **アイコンだけ**なので、呼び名とショートカットは Tips（title）が担う。
// 並びと絵は editor/format-toolbar が持ち、ここは並べて押させるだけ。

import { Fragment, useState } from "react";
import { COLOR_PALETTE } from "../lib/text-color";
import type { FormatKind } from "../editor/format-commands";
import { FORMAT_TOOLBAR, formatHint } from "../editor/format-toolbar";
import { PathIcon } from "./MenuIcon";

export function FormatToolbar({
  onFormat,
  onTable,
  onColor,
}: {
  onFormat: (kind: FormatKind) => void;
  /// 表だけは行 × 列を聞く窓を挟む
  onTable: () => void;
  /// 文字色（ADR-0061）。16 進で付ける、null で外す
  onColor?: (hex: string | null) => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <div className="format-toolbar" role="toolbar" aria-label="書式">
      {FORMAT_TOOLBAR.map((group, index) => (
        <Fragment key={group[0].kind}>
          {index > 0 && (
            <span className="toolbar-separator" aria-hidden="true" />
          )}
          {group.map((item) => (
            <button
              key={item.kind}
              title={formatHint(item)}
              aria-label={item.label}
              // **押しても本文の選択を外さない。** 外すと囲むものが無くなって
              // 空振りする（参照実装が NoFocus で守っていたのと同じ勘所）
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                item.kind === "table" ? onTable() : onFormat(item.kind)
              }
            >
              <PathIcon paths={item.paths} />
            </button>
          ))}
        </Fragment>
      ))}
      {onColor && (
        <>
          <span className="toolbar-separator" aria-hidden="true" />
          <button
            title="文字色"
            aria-label="文字色"
            aria-expanded={paletteOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <PathIcon paths={COLOR_ICON} />
          </button>
          {paletteOpen && (
            <span
              className="color-palette"
              role="group"
              aria-label="文字色の候補"
            >
              {COLOR_PALETTE.map((swatch) => (
                <button
                  key={swatch.hex}
                  className="color-swatch"
                  style={{ background: swatch.hex }}
                  title={swatch.label}
                  aria-label={`色: ${swatch.label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setPaletteOpen(false);
                    onColor(swatch.hex);
                  }}
                />
              ))}
              <button
                title="色を消す"
                aria-label="色を消す"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setPaletteOpen(false);
                  onColor(null);
                }}
              >
                <PathIcon paths={CLEAR_ICON} />
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}

/// 文字色の絵: A の下に色の帯。線だけ（他のアイコンと同じ作法）
const COLOR_ICON = ["M4 11.5 8 3l4 8.5M5.5 8.5h5", "M3 14h10"];
/// 色を消す: A に斜線
const CLEAR_ICON = ["M3 13 13 3", "M4 11.5 8 3l4 8.5"];
