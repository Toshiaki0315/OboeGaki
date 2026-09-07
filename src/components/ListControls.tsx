// 一覧の操作行。並び順（C-3）と「＋ 新規」を横に並べる（要望 2026-09-07:
// 検索欄 → 絞り込みのラベル → この行、の 3 段にまとめる）。
// 並び順が意味を持たないとき（ゴミ箱・検索中）は select を出さず、
// 「＋ 新規」だけ右に残す。

import type { SortOrder } from "../lib/note-order";

export type ListControlsProps = {
  sortOrder: SortOrder;
  onSort: (order: SortOrder) => void;
  showSort: boolean;
  /// 「＋ 新規」の置き場所の説明（title に出す）
  newTitle: string;
  /// 左クリック: 無題のノートを作る
  onNew: () => void;
  /// 右クリック: 作り方を選ぶメニュー（テンプレートから・今日のノート）を
  /// 押した場所に出す（要望 2026-09-07）
  onNewMenu: (at: { x: number; y: number }) => void;
};

export function ListControls({
  sortOrder,
  onSort,
  showSort,
  newTitle,
  onNew,
  onNewMenu,
}: ListControlsProps) {
  return (
    <div className="sort-row">
      {showSort && (
        <select
          value={sortOrder}
          onChange={(event) => onSort(event.currentTarget.value as SortOrder)}
        >
          <option value="modified">更新順</option>
          <option value="title">名前順</option>
        </select>
      )}
      <button
        className="new-note-button"
        title={`${newTitle}（右クリックで作り方を選べます）`}
        onClick={onNew}
        onContextMenu={(event) => {
          event.preventDefault(); // OS の既定のメニューを出さない
          onNewMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        ＋ 新規
      </button>
    </div>
  );
}
