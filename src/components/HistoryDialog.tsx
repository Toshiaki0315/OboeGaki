// 版の履歴（ADR-0023）。一覧を見せて「戻す」を親に知らせるだけ —
// 書き戻しと自動保存の取り回しは親（App）が持つ。

import type { HistoryEntry } from "../stores/app";

export function HistoryDialog({
  entries,
  onRestore,
  onClose,
}: {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onClose: () => void;
}) {
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="版の履歴"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">
          版の履歴（新しい順・戻す前に今の内容も残ります）
        </header>
        <ul>
          {entries.map((entry) => (
            <li key={entry.path} className="history-row">
              <span>{entry.stamp}</span>
              <button onClick={() => onRestore(entry)}>戻す</button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="no-hits">
              まだ版がありません（保存から 60 分間隔で残ります）
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
