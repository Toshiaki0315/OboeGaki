// あいまい検索のパレット。クイックオープン（Cmd+P）と見出しへ飛ぶ（Cmd+R、
// C-2）が同じ操作 — 入口が増えても操作を覚え直さない。打った字と選択位置は
// **このパレットだけが持つ**（打鍵ごとに App を描き直さない）。

import { useMemo, useState } from "react";
import { rankCandidates } from "../lib/fuzzy";
import { imeEnterGuard } from "../lib/ime";

export type FuzzyPaletteProps = {
  placeholder: string;
  labels: readonly string[];
  /// 並べる上限。多すぎると選べない
  limit: number;
  /// 行の字下げ（rem、基本の 0.5 に足す）。階層を見せたいとき
  indentOf?: (index: number) => number;
  /// 選ばれた行の、**labels での**番号
  onChoose: (index: number) => void;
  onClose: () => void;
};

export function FuzzyPalette({
  placeholder,
  labels,
  limit,
  indentOf,
  onChoose,
  onClose,
}: FuzzyPaletteProps) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  // 変換中の Enter は IME の確定（T5）。選ぶのは確定後の Enter
  const ime = useMemo(() => imeEnterGuard(), []);
  const ranked = useMemo(
    () => rankCandidates(query, [...labels]).slice(0, limit),
    [query, labels, limit],
  );

  function choose(rankedIndex: number) {
    const original = ranked[rankedIndex];
    if (original === undefined) return;
    onChoose(original);
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={placeholder}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setAt(0);
          }}
          onCompositionEnd={(event) => ime.onCompositionEnd(event.nativeEvent)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") {
              event.preventDefault();
              setAt((i) => Math.min(i + 1, ranked.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setAt((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (!ime.isImeEnter(event.nativeEvent)) choose(at);
            }
          }}
        />
        <ul>
          {ranked.map((original, rankedIndex) => (
            <li key={original}>
              <button
                className={rankedIndex === at ? "selected" : ""}
                style={
                  indentOf
                    ? { paddingLeft: `${0.5 + indentOf(original)}rem` }
                    : undefined
                }
                onMouseEnter={() => setAt(rankedIndex)}
                onClick={() => choose(rankedIndex)}
              >
                {labels[original]}
              </button>
            </li>
          ))}
          {ranked.length === 0 && <li className="no-hits">見つかりません</li>}
        </ul>
      </div>
    </div>
  );
}
