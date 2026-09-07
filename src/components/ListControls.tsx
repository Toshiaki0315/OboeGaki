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
  onNew: () => void;
};

export function ListControls({
  sortOrder,
  onSort,
  showSort,
  newTitle,
  onNew,
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
      <button className="new-note-button" title={newTitle} onClick={onNew}>
        ＋ 新規
      </button>
    </div>
  );
}
