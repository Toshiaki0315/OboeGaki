// サイドバーまわりの小さな右クリック: 「＋ 新規」の作り方・タグ・目次の節。
// 何を並べるかは純関数で決める（note-menu と同じ構え。19-4 で App.tsx から）

import { MenuIcon } from "./MenuIcon";
import type { MenuEntry } from "./MenuList";

/// 「＋ 新規」の右クリック。左クリックは無題のノート。ここは**別の作り方**だけ
/// （メニューバーの「ファイル」と同じ動作を使い回す）
export function newNoteMenuItems(act: {
  onTemplate: () => void;
  onDaily: () => void;
}): MenuEntry[] {
  return [
    {
      label: "テンプレートから新規…",
      icon: <MenuIcon name="template" />,
      onSelect: act.onTemplate,
    },
    {
      label: "今日のノート",
      icon: <MenuIcon name="noteNew" />,
      onSelect: act.onDaily,
    },
  ];
}

export type TagMenuActions = {
  /// null で絞り込みを解除
  onFilter: (tag: string | null) => void;
  onSearch: (tag: string) => void;
  onCopy: (tag: string) => void;
  onRename: (tag: string) => void;
};

export function tagMenuItems(
  { tag, filtered }: { tag: string; filtered: boolean },
  act: TagMenuActions,
): MenuEntry[] {
  return [
    {
      label: filtered ? "絞り込みを解除" : `#${tag} で絞り込む`,
      onSelect: () => act.onFilter(filtered ? null : tag),
    },
    // 絞り込みは一覧を狭めるだけ。**本文まで見たいとき**は検索へ回す
    // （同じ書き方が検索欄でも効く）
    {
      label: "このタグで全ノート検索",
      icon: <MenuIcon name="search" />,
      onSelect: () => act.onSearch(tag),
    },
    { kind: "separator" },
    {
      label: "タグ名をコピー",
      icon: <MenuIcon name="copy" />,
      onSelect: () => act.onCopy(tag),
    },
    { kind: "separator" },
    // 全ノートの #タグ を書き換える（ADR-0055）。既にある名前なら統合
    { label: "名前を変更…", onSelect: () => act.onRename(tag) },
  ];
}

/// 目次の節を動かす（7-1。ポメラのアウトライン相当）。端では押しても何も起きない
/// ので、知らせを出すのは呼ぶ側
export function outlineMenuItems(act: {
  onMove: (delta: -1 | 1) => void;
}): MenuEntry[] {
  return [
    {
      label: "この節を上へ動かす",
      icon: <MenuIcon name="moveUp" />,
      onSelect: () => act.onMove(-1),
    },
    {
      label: "この節を下へ動かす",
      icon: <MenuIcon name="moveDown" />,
      onSelect: () => act.onMove(1),
    },
  ];
}
