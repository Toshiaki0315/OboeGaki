// アウトライン（Cmd+5、ADR-0022）。出しっぱなしの目次 — 飛んだら閉じる
// 見出しパレット（Cmd+R）とは別の道具。現在地は親が決める（キャレット位置
// 以前の最後の見出し）。

import type { OutlineItem } from "../editor/outline";

export type OutlinePaneProps = {
  items: readonly OutlineItem[];
  /// 現在地の行番号。無ければ -1
  currentIndex: number;
  onJump: (from: number) => void;
  /// 右クリック（節ごと動かす = 7-1）。節の位置と押した場所
  onMenu: (at: { from: number; x: number; y: number }) => void;
};

export function OutlinePane({
  items,
  currentIndex,
  onJump,
  onMenu,
}: OutlinePaneProps) {
  return (
    <aside className="outline-pane">
      <header>目次</header>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.from}-${item.text}`}>
            <button
              className={index === currentIndex ? "current" : ""}
              style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.9}rem` }}
              title="右クリックで節ごと動かせます"
              onClick={() => onJump(item.from)}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu({ from: item.from, x: event.clientX, y: event.clientY });
              }}
            >
              {item.text}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="no-hits">見出しがありません</li>}
      </ul>
    </aside>
  );
}
