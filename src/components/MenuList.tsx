// 右クリックメニューの項目。何を並べるかは呼び出し側が配列で決め、ここは
// 描いて「まず閉じてから動く」を守るだけ（閉じる前に動くと、確認ダイアログ
// の後ろにメニューが残る）。

import type { ReactNode } from "react";
import { SubMenu } from "./ContextMenu";

export type MenuEntry =
  | {
      kind?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      /// 項目ごと消すと理由が分からない。押せない状態で見せる
      disabled?: boolean;
      /// 押せない理由など
      title?: string;
      /// 取り返しのつかない操作（赤系で目立たせる）
      danger?: boolean;
      /// 付いていなければ印の枠を出さない。false なら空の枠（頭を揃える）
      checked?: boolean;
    }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; icon: ReactNode; items: MenuEntry[] };

export function MenuList({
  items,
  onPick,
}: {
  items: readonly MenuEntry[];
  /// 項目を押したときに、動く前に呼ぶ（メニューを閉じる）
  onPick: () => void;
}) {
  return (
    <>
      {items.map((entry, index) => {
        if (entry.kind === "separator") {
          return <li key={index} className="separator" />;
        }
        if (entry.kind === "submenu") {
          return (
            <SubMenu key={index} icon={entry.icon} label={entry.label}>
              <MenuList items={entry.items} onPick={onPick} />
            </SubMenu>
          );
        }
        return (
          <li key={index}>
            <button
              className={entry.danger ? "danger" : ""}
              disabled={entry.disabled}
              title={entry.title}
              onClick={() => {
                onPick();
                entry.onSelect();
              }}
            >
              {/* **印は幅を持つ枠に入れる。** 全角の空白で字下げすると JSX が
                行頭の空白を落として揃わない（実機報告 2026-09-04） */}
              {entry.checked !== undefined && (
                <span className="menu-check">{entry.checked ? "✓" : ""}</span>
              )}
              {entry.icon}
              {entry.label}
            </button>
          </li>
        );
      })}
    </>
  );
}
