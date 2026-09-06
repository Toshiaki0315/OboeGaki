// 線で描く 16×16 のアイコン。メニューの項目・書式ツールバー・アシスタントの
// ボタンが同じ描き方（stroke = currentColor）なので 1 つにする。

import { MENU_ICONS, type MenuIconName } from "../lib/menu-icons";

export function PathIcon({
  paths,
  className,
  strokeWidth = 1.4,
}: {
  paths: readonly string[];
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/// メニューの項目に添える絵。**名前で引く**（同じ言葉には同じ絵）。
export function MenuIcon({ name }: { name: MenuIconName }) {
  return (
    <PathIcon
      className="menu-icon"
      paths={MENU_ICONS[name]}
      strokeWidth={1.3}
    />
  );
}
