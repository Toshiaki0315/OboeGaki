// 一覧から 1 つ選ぶパレット。テンプレートを選ぶ（E-4）とフォルダへ移動
// （ADR-0024）が同じ形。矢印と Enter で選べるよう先頭にフォーカスを置く。
// 選択位置は**このパレットだけが持つ**。

import { useState } from "react";

export type ListItem = {
  key: string;
  label: string;
  /// 階層の深さ（字下げに使う）。無ければ字下げしない
  indent?: number;
};

export type ListPaletteProps = {
  title: string;
  items: readonly ListItem[];
  /// 選ばれた行の、items での番号
  onChoose: (index: number) => void;
  onClose: () => void;
};

export function ListPalette({
  title,
  items,
  onChoose,
  onClose,
}: ListPaletteProps) {
  const [at, setAt] = useState(0);
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            setAt((i) => Math.min(i + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setAt((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (items[at]) onChoose(at);
          }
        }}
      >
        <header className="palette-title">{title}</header>
        <ul>
          {items.map((item, index) => (
            <li key={item.key}>
              <button
                autoFocus={index === 0}
                className={index === at ? "selected" : ""}
                style={
                  item.indent === undefined
                    ? undefined
                    : { paddingLeft: `${0.5 + item.indent * 0.8}rem` }
                }
                onMouseEnter={() => setAt(index)}
                onClick={() => onChoose(index)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
