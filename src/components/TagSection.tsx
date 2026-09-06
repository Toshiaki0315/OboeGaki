// サイドバーのタグ一覧（C-4）。開閉はフォルダと排他なので親が持つ
// （ユーザー要望 2026-09-04: 両方開くと一覧が痩せすぎる）。

import type { TagCount } from "../stores/app";
import { MenuIcon } from "./MenuIcon";

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
    <details className="tag-section" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault(); // 開閉はこちらで持つ（フォルダと排他）
          onToggle();
        }}
      >
        <span className="side-twist" aria-hidden="true" />
        <MenuIcon name="tag" />
        <span className="side-label">タグ</span>
        <span className="side-count">{tags.length}</span>
      </summary>
      <ul>
        {tags.map(({ tag, count }) => (
          <li key={tag}>
            <button
              className={`tag-row${tag === tagFilter ? " selected" : ""}`}
              title="右クリックで絞る・検索・コピー"
              onClick={() => onFilter(tag === tagFilter ? null : tag)}
              // **OS の既定のメニューを出さない**（要望 2026-09-04）。
              // 「Google で検索」「共有」など、選んだ文字を外へ出す道が並ぶ
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu({ tag, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="tag-name">#{tag}</span>
              <span className="tag-count">{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
