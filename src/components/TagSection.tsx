// サイドバーのタグ一覧（C-4）。開閉はフォルダと排他なので親が持つ
// （ユーザー要望 2026-09-04: 両方開くと一覧が痩せすぎる）。

import type { TagCount } from "../lib/ipc";
import { SideSection } from "./SideSection";
import { menuAt } from "../lib/context-menu";

export type TagSectionProps = {
  tags: readonly TagCount[];
  tagFilter: string | null;
  open: boolean;
  onToggle: () => void;
  /// null で絞り込みを解除
  onFilter: (tag: string | null) => void;
  onMenu: (at: { tag: string; x: number; y: number }) => void;
};

export function TagSection({
  tags,
  tagFilter,
  open,
  onToggle,
  onFilter,
  onMenu,
}: TagSectionProps) {
  return (
    <SideSection
      className="tag-section"
      icon="tag"
      label="タグ"
      count={tags.length}
      open={open}
      onToggle={onToggle}
    >
      <ul>
        {tags.map(({ tag, count }) => (
          <li key={tag}>
            <button
              className={`tag-row${tag === tagFilter ? " selected" : ""}`}
              title="右クリックで絞る・検索・コピー"
              onClick={() => onFilter(tag === tagFilter ? null : tag)}
              onContextMenu={menuAt(onMenu, { tag })}
            >
              <span className="tag-name">#{tag}</span>
              <span className="tag-count">{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </SideSection>
  );
}
