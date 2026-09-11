// 版の履歴（ADR-0023）。一覧を見せて「戻す」を親に知らせる — 書き戻しと
// 自動保存の取り回しは親（App）が持つ。
//
// 版を選ぶと**差分**を出す（ADR-0054）。何が変わったか分からないと「戻すか」
// を決められない。比べる相手は「今の本文」か「1 つ前の版」。

import { useEffect, useState } from "react";
import { diffLines, foldSame } from "../lib/diff";
import type { HistoryEntry } from "../lib/ipc";

type Compare = "current" | "previous";

export function HistoryDialog({
  entries,
  currentText,
  readVersion,
  onRestore,
  onClose,
}: {
  entries: HistoryEntry[];
  /// 今の本文（開いた時点で書き切ったもの）
  currentText: string;
  /// 版の本文を読む（読むだけ。書き戻しは onRestore）
  readVersion: (entry: HistoryEntry) => Promise<string>;
  onRestore: (entry: HistoryEntry) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<Compare>("current");
  const [texts, setTexts] = useState<Record<string, string>>({});

  const chosen = selected === null ? null : entries[selected];
  // 一覧は新しい順なので「1 つ前の版」は次の要素
  const previous =
    selected !== null && selected + 1 < entries.length
      ? entries[selected + 1]
      : null;

  useEffect(() => {
    const wanted = [chosen, compare === "previous" ? previous : null].filter(
      (entry): entry is HistoryEntry => entry !== null,
    );
    for (const entry of wanted) {
      if (texts[entry.path] !== undefined) continue;
      readVersion(entry)
        .then((text) =>
          setTexts((current) => ({ ...current, [entry.path]: text })),
        )
        .catch(() => setTexts((current) => ({ ...current, [entry.path]: "" })));
    }
    // texts は増えるだけ。読んだものを鍵に再入しない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, previous, compare]);

  // 差分は**古い側 → 新しい側**で見る（足された行が緑）。「今の本文」なら
  // 版 → 今、「1 つ前の版」なら前の版 → この版
  const chosenText = chosen ? texts[chosen.path] : undefined;
  const pair: [string | undefined, string | undefined] =
    compare === "current"
      ? [chosenText, currentText]
      : [previous ? texts[previous.path] : undefined, chosenText];
  const rows =
    pair[0] !== undefined && pair[1] !== undefined
      ? foldSame(diffLines(pair[0], pair[1]))
      : null;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette history-palette"
        role="dialog"
        aria-label="版の履歴"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">
          版の履歴（新しい順・戻す前に今の内容も残ります）
        </header>
        <ul>
          {entries.map((entry, index) => (
            <li
              key={entry.path}
              className={`history-row${index === selected ? " selected" : ""}`}
            >
              <button
                className="history-stamp"
                onClick={() => setSelected(index)}
                aria-pressed={index === selected}
              >
                {entry.stamp}
              </button>
              <button onClick={() => onRestore(entry)}>戻す</button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="no-hits">
              まだ版がありません（保存から 60 分間隔で残ります）
            </li>
          )}
        </ul>
        {chosen && (
          <section className="history-diff" aria-label="差分">
            <div className="history-compare">
              <button
                aria-pressed={compare === "current"}
                onClick={() => setCompare("current")}
              >
                今の本文と比べる
              </button>
              <button
                aria-pressed={compare === "previous"}
                disabled={previous === null}
                onClick={() => setCompare("previous")}
              >
                1 つ前の版と比べる
              </button>
            </div>
            {rows === null ? (
              <p className="no-hits">読み込み中…</p>
            ) : rows.length === 0 ? (
              <p className="no-hits">違いはありません</p>
            ) : (
              <pre className="diff-view">
                {rows.map((row, index) =>
                  row.kind === "skip" ? (
                    <span key={index} className="diff-skip">
                      … {row.count} 行は同じ …{"\n"}
                    </span>
                  ) : (
                    <span key={index} className={`diff-${row.kind}`}>
                      {row.text}
                      {"\n"}
                    </span>
                  ),
                )}
              </pre>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
