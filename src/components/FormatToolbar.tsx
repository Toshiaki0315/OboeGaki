// 書式ツールバー（B-1）。ショートカットを覚えていなくても押せるようにする。
// **アイコンだけ**なので、呼び名とショートカットは Tips（title）が担う。
// 並びと絵は editor/format-toolbar が持ち、ここは並べて押させるだけ。

import { Fragment } from "react";
import type { FormatKind } from "../editor/format-commands";
import { FORMAT_TOOLBAR, formatHint } from "../editor/format-toolbar";
import { PathIcon } from "./MenuIcon";

export function FormatToolbar({
  onFormat,
  onTable,
}: {
  onFormat: (kind: FormatKind) => void;
  /// 表だけは行 × 列を聞く窓を挟む
  onTable: () => void;
}) {
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
    </div>
  );
}
