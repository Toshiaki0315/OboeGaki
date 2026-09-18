// サイドバーの折りたたむ節（19-3）。タグ・やること・保存した検索が同じ
// `<details><summary>` の頭を各自で書いていた。フォルダの節は頭に絞り込みの
// ボタンと落とし先を持つので別（FolderSection）。
// **開閉は親が持つ**（節どうしの排他）— `onToggle` が無い節は開いたまま

import type { ReactNode } from "react";
import { MenuIcon } from "./MenuIcon";
import type { MenuIconName } from "../lib/menu-icons";

export function SideSection({
  className,
  icon,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  className: string;
  icon: MenuIconName;
  label: string;
  count: number;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <details className={className} open={open}>
      <summary
        onClick={
          onToggle
            ? (event) => {
                event.preventDefault(); // 開閉はこちらで持つ（節どうしで排他）
                onToggle();
              }
            : undefined
        }
      >
        <span className="side-twist" aria-hidden="true" />
        <MenuIcon name={icon} />
        <span className="side-label">{label}</span>
        <span className="side-count">{count}</span>
      </summary>
      {children}
    </details>
  );
}
