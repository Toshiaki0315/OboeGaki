// 捨てたノートの一覧（要望 2026-09-05）。**出せる操作を絞る** — ゴミ箱の
// 中身にピン留めや改名を許すと、戻したときの状態が読めない（参照実装
// note_actions と同じ判断）。戻す・消すは右クリックから。

import { formatStamp } from "../lib/note-order";
import { trashLabel, trashParts } from "../lib/trash-label";
import type { TrashEntry } from "../lib/ipc";

export type TrashRowsProps = {
  vaultRoot: string;
  entries: readonly TrashEntry[];
  currentPath: string | null;
  /// 捨てたノートを残す日数（空のときの案内に添える）
  trashDays: number;
  onOpen: (path: string) => void;
  onMenu: (at: { path: string; x: number; y: number }) => void;
};

export function TrashRows({
  vaultRoot,
  entries,
  currentPath,
  trashDays,
  onOpen,
  onMenu,
}: TrashRowsProps) {
  return (
    <ul className="note-rows">
      {entries.length === 0 && (
        <li className="no-hits">
          ゴミ箱は空です。捨てたノートは {trashDays} 日残ります
        </li>
      )}
      {entries.map((entry) => {
        const { name, folder } = trashParts(vaultRoot, entry.path);
        return (
          <li key={entry.path} className="trash-item">
            <button
              className={`trash-row${entry.path === currentPath ? " selected" : ""}`}
              title={`${trashLabel(vaultRoot, entry.path)}（右クリックで戻す・削除）`}
              onClick={() => onOpen(entry.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu({
                  path: entry.path,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <span className="trash-name">{name}</span>
              <span className="trash-meta">
                {/* 元の場所。直下のノートには出さない */}
                {folder && <span className="trash-folder">{folder}</span>}
                <span className="trash-stamp">
                  {formatStamp(entry.trashedMs)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
