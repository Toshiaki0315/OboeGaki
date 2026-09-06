// ノートの操作ボタン列。アイコンでペインの右端に寄せる（題名の幅とは独立。
// ユーザー要望 2026-09-04）。並びはピン → 書き出し → 履歴 → ゴミ箱 →
// ソース表示切替。

export type NoteActionsProps = {
  pinned: boolean;
  sourceMode: boolean;
  onPin: () => void;
  onExport: () => void;
  onHistory: () => void;
  onTrash: () => void;
  onToggleSource: () => void;
};

export function NoteActions({
  pinned,
  sourceMode,
  onPin,
  onExport,
  onHistory,
  onTrash,
  onToggleSource,
}: NoteActionsProps) {
  return (
    <div className="note-actions" role="group" aria-label="ノートの操作">
      <button
        className={pinned ? "selected" : ""}
        title={pinned ? "ピンを外す" : "ピン留め（一覧の先頭に固定）"}
        aria-pressed={pinned}
        onClick={onPin}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M9.5 2 14 6.5l-3 1-2.5 4.5L4 7.5 8.5 5l1-3Z"
            fill={pinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M6 10 2.5 13.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button title="HTML に書き出し" onClick={onExport}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 10V2.5M5 5l3-3 3 3M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button title="版の履歴" onClick={onHistory}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M8 5v3.2l2.2 1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button title="ゴミ箱へ移動" onClick={onTrash}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8M6.7 7v4M9.3 7v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className={sourceMode ? "selected" : ""}
        title={sourceMode ? "通常表示に戻す（Cmd+/）" : "ソース表示（Cmd+/）"}
        aria-pressed={sourceMode}
        onClick={onToggleSource}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
