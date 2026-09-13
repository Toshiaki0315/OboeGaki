// 右クリックに並べるもの（ADR-0048 の続き / TASKS 15-7）。
// ノート・フォルダ・ゴミ箱 — **判断があるものだけ**を出した。
//
// **何を並べるかは純関数で決める。** App.tsx に直書きしていた頃は、
// 「ピン留め中は捨てられない」のような判断が JSX の奥に埋まっていて
// テストが書けなかった。描くのは MenuList、押したときに何が起きるかは
// 呼ぶ側（App）が渡す。

import type { MenuEntry } from "./MenuList";
import { MenuIcon } from "./MenuIcon";

export type NoteMenuFacts = {
  /// 対象のノート（絶対パス）
  path: string;
  /// ピン留め中か（spec §7.3 の削除ガードに効く）
  pinned: boolean;
  /// Claude（MCP）に渡さない場所か
  hiddenFromMcp: boolean;
};

export type NoteMenuActions = {
  onPin: (path: string) => void;
  onToggleMcpHidden: (path: string) => void;
  onOpenBeside: (path: string) => void;
  onDuplicate: (path: string) => void;
  onMove: (path: string) => void;
  onSaveTemplate: (path: string) => void;
  onCopyLink: (path: string) => void;
  onReveal: (path: string) => void;
  onTrash: (path: string) => void;
};

export function noteMenuItems(
  facts: NoteMenuFacts,
  act: NoteMenuActions,
): MenuEntry[] {
  const { path, pinned, hiddenFromMcp } = facts;
  return [
    {
      label: pinned ? "ピンを外す" : "ピン留め",
      icon: <MenuIcon name="pin" />,
      onSelect: () => act.onPin(path),
    },
    // 渡す / 渡さないはピンと同じ手触りで（要望 2026-09-12）。
    // 中身は `.mcp-ignore` の 1 行
    {
      label: hiddenFromMcp ? "Claude に渡す" : "Claude に渡さない",
      icon: <MenuIcon name="mcp" />,
      onSelect: () => act.onToggleMcpHidden(path),
    },
    // **本文を入れ替える「開く」とは別の道**（U-1）。書いているノートを
    // 奪わずに、もう 1 枚を並べる
    {
      label: "横に開く",
      icon: <MenuIcon name="beside" />,
      onSelect: () => act.onOpenBeside(path),
    },
    {
      label: "複製",
      icon: <MenuIcon name="copy" />,
      onSelect: () => act.onDuplicate(path),
    },
    {
      label: "フォルダへ移動…",
      icon: <MenuIcon name="move" />,
      onSelect: () => act.onMove(path),
    },
    {
      label: "テンプレートに登録…",
      icon: <MenuIcon name="template" />,
      onSelect: () => act.onSaveTemplate(path),
    },
    { kind: "separator" },
    {
      label: "リンクをコピー",
      icon: <MenuIcon name="link" />,
      onSelect: () => act.onCopyLink(path),
    },
    {
      label: "Finder で表示",
      icon: <MenuIcon name="finder" />,
      onSelect: () => act.onReveal(path),
    },
    { kind: "separator" },
    {
      // 消せない理由は**項目を消さずに見せる**（G-3 の構え）
      label: "ゴミ箱へ移動",
      icon: <MenuIcon name="trash" />,
      danger: true,
      disabled: pinned,
      title: pinned ? "ピン留め中は捨てられません" : "ゴミ箱へ移動",
      onSelect: () => act.onTrash(path),
    },
  ];
}

export type FolderMenuFacts = {
  /// 対象のフォルダ（保管フォルダからの相対）。**空文字は「直下」の行**
  folder: string;
  hiddenFromMcp: boolean;
};

export type FolderMenuActions = {
  onNewNote: (folder: string) => void;
  onNewFolder: (folder: string) => void;
  onReveal: (folder: string) => void;
  onToggleMcpHidden: (folder: string) => void;
  onRename: (folder: string) => void;
  onDelete: (folder: string) => void;
};

export function folderMenuItems(
  facts: FolderMenuFacts,
  act: FolderMenuActions,
): MenuEntry[] {
  const { folder, hiddenFromMcp } = facts;
  // 空文字は保管フォルダの直下（「直下」の行）。名前も変えられないし
  // 消せないので、作る項目だけ出す
  const isRoot = folder === "";
  return [
    {
      label: "新規ノート",
      icon: <MenuIcon name="noteNew" />,
      onSelect: () => act.onNewNote(folder),
    },
    {
      label: "新規フォルダ…",
      icon: <MenuIcon name="folderNew" />,
      onSelect: () => act.onNewFolder(folder),
    },
    {
      label: "Finder で開く",
      icon: <MenuIcon name="finder" />,
      onSelect: () => act.onReveal(folder),
    },
    // 保管フォルダそのものは出さない — 全部を隠すのは `.mcp-ignore` の
    // 仕事ではなく、設定を外す仕事
    ...(isRoot
      ? []
      : [
          {
            label: hiddenFromMcp ? "Claude に渡す" : "Claude に渡さない",
            icon: <MenuIcon name="mcp" />,
            onSelect: () => act.onToggleMcpHidden(folder),
          } satisfies MenuEntry,
        ]),
    ...(isRoot
      ? []
      : ([
          { kind: "separator" },
          {
            label: "名前を変更…",
            icon: <MenuIcon name="rename" />,
            onSelect: () => act.onRename(folder),
          },
          {
            label: "削除",
            icon: <MenuIcon name="trash" />,
            danger: true,
            onSelect: () => act.onDelete(folder),
          },
        ] satisfies MenuEntry[])),
  ];
}

export type TrashMenuActions = {
  onReveal: () => void;
  onEmpty: () => void;
  onRestore: (path: string) => void;
  onDeleteForever: (path: string) => void;
};

/// ゴミ箱の右クリック。`path` が null なら「ゴミ箱」の行そのもの
export function trashMenuItems(
  path: string | null,
  act: TrashMenuActions,
): MenuEntry[] {
  return [
    {
      label: "Finder で開く",
      icon: <MenuIcon name="finder" />,
      onSelect: () => act.onReveal(),
    },
    { kind: "separator" },
    ...(path === null
      ? ([
          {
            label: "ゴミ箱を空にする…",
            icon: <MenuIcon name="trash" />,
            danger: true,
            onSelect: () => act.onEmpty(),
          },
        ] satisfies MenuEntry[])
      : ([
          {
            label: "元に戻す",
            icon: <MenuIcon name="restore" />,
            onSelect: () => act.onRestore(path),
          },
          { kind: "separator" },
          {
            // 取り返しがつかない（G-3）。確認は呼ぶ側が挟む
            label: "完全に削除",
            icon: <MenuIcon name="trash" />,
            danger: true,
            onSelect: () => act.onDeleteForever(path),
          },
        ] satisfies MenuEntry[])),
  ];
}
