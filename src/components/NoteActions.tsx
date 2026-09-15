// ノートの操作ボタン列。アイコンでペインの右端に寄せる（題名の幅とは独立。
// ユーザー要望 2026-09-04）。並びはピン → 書き出し → 履歴 → ゴミ箱 →
// 編集モード（インライン／ソース／プレビューを 1 つのボタンで巡る。
// 要望 2026-09-15。**今どこかを絵で見せる** — 3 つを巡るボタンは、今の
// 位置が見えないと押せない）。

import type { ReactElement } from "react";
import {
  EDIT_MODE_LABELS,
  nextEditMode,
  type EditMode,
} from "../lib/edit-mode";

export type NoteActionsProps = {
  pinned: boolean;
  editMode: EditMode;
  onPin: () => void;
  onExport: () => void;
  onHistory: () => void;
  onTrash: () => void;
  /// 次の編集モードへ（インライン → ソース → プレビュー → インライン）
  onCycleMode: () => void;
};

/// 編集モードの絵（16×16 の線。他のボタンと同じ太さ）。
/// インライン = 本文に鉛筆（書きながら見る）、ソース = `<>`、
/// プレビュー = 目（見るだけに近い）
const MODE_ICONS: Record<EditMode, ReactElement> = {
  inline: (
    <>
      <path
        d="M3 4h10M3 8h5M3 12h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="m9.5 13.5 4.2-4.2 1.3 1.3-4.2 4.2H9.5v-1.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </>
  ),
  source: (
    <path
      d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  preview: (
    <>
      <path
        d="M1.5 8c1.6-2.9 3.8-4.4 6.5-4.4S12.9 5.1 14.5 8c-1.6 2.9-3.8 4.4-6.5 4.4S3.1 10.9 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle
        cx="8"
        cy="8"
        r="2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </>
  ),
};

export function NoteActions({
  pinned,
  editMode,
  onPin,
  onExport,
  onHistory,
  onTrash,
  onCycleMode,
}: NoteActionsProps) {
  const next = nextEditMode(editMode);
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
        // インライン以外は「いつもと違う」ので押された見た目にする
        className={editMode === "inline" ? "" : "selected"}
        title={`編集モード: ${EDIT_MODE_LABELS[editMode]}（押すと${EDIT_MODE_LABELS[next]}へ）`}
        data-mode={editMode}
        onClick={onCycleMode}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {MODE_ICONS[editMode]}
        </svg>
      </button>
    </div>
  );
}
