// 右クリックのメニュー 8 種の枠（20-2）。**開いているのは 1 つ**を型で言う —
// App.tsx は 8 本の useState で位置と中身を別々に持ち、同じ 6 行の枠を
// 8 回書いていた。何を並べるかは各 *-menu の純関数、押したときに何が起きるか
// は App（actions で受ける）。ここは「どれが開いているか → 枠と項目」だけ。

import type { Point } from "../lib/context-menu";
import { anchorAbove } from "../lib/context-menu";
import { ContextMenu } from "./ContextMenu";
import {
  editorMenuItems,
  type EditorMenuActions,
  type EditorMenuFacts,
} from "./editor-menu";
import {
  gearMenuItems,
  type GearMenuActions,
  type GearMenuFacts,
} from "./gear-menu";
import { MenuList, type MenuEntry } from "./MenuList";
import {
  folderMenuItems,
  noteMenuItems,
  trashMenuItems,
  type FolderMenuActions,
  type FolderMenuFacts,
  type NoteMenuActions,
  type NoteMenuFacts,
  type TrashMenuActions,
} from "./note-menu";
import {
  newNoteMenuItems,
  outlineMenuItems,
  tagMenuItems,
  type TagMenuActions,
} from "./side-menus";

/// 今開いている右クリックのメニュー。null は閉じている。
/// 歯車だけは押した絵の**真上**に出すので、位置の持ち方が違う（left / top）
export type OpenMenu =
  | ({ kind: "new" } & Point)
  | ({ kind: "note"; path: string } & Point)
  | ({ kind: "editor" } & EditorMenuFacts & Point)
  | { kind: "gear"; left: number; top: number }
  | ({ kind: "tag"; tag: string } & Point)
  | ({ kind: "folder"; folder: string } & Point)
  | ({ kind: "outline"; from: number } & Point)
  /// path が null なら「ゴミ箱そのもの」への操作（空にする）
  | ({ kind: "trash"; path: string | null } & Point);

export type MenuKind = OpenMenu["kind"];
/// `kind` を除いた、開くときに渡す値
export type MenuData<K extends MenuKind> = Omit<
  Extract<OpenMenu, { kind: K }>,
  "kind"
>;

/// 開く関数を種類ごとに作る（`onMenu={openMenu("note")}` と書ける）
export function menuOpener<K extends MenuKind>(
  set: (menu: OpenMenu) => void,
  kind: K,
): (data: MenuData<K>) => void {
  // K ごとの形は呼び手で型検査済み。TS は generic の K から判別共用体の
  // 1 枝を合成できないので、ここだけ広げてから戻す
  return (data) => set({ kind, ...data } as unknown as OpenMenu);
}

export type AppContextMenusProps = {
  menu: OpenMenu | null;
  onClose: () => void;
  newNote: Parameters<typeof newNoteMenuItems>[0];
  note: {
    /// 対象の今の姿（ピン・MCP から隠れているか）を引く
    facts: (path: string) => Omit<NoteMenuFacts, "path">;
    actions: NoteMenuActions;
  };
  editor: EditorMenuActions;
  gear: { facts: GearMenuFacts; actions: GearMenuActions };
  tag: {
    /// そのタグで絞り込み中か
    filtered: (tag: string) => boolean;
    actions: TagMenuActions;
  };
  folder: {
    facts: (folder: string) => Omit<FolderMenuFacts, "folder">;
    actions: FolderMenuActions;
  };
  outline: { onMove: (from: number, delta: -1 | 1) => void };
  trash: TrashMenuActions;
};

/// 開いているメニューに並べるもの
export function itemsFor(
  menu: OpenMenu,
  props: Omit<AppContextMenusProps, "menu" | "onClose">,
): MenuEntry[] {
  switch (menu.kind) {
    case "new":
      return newNoteMenuItems(props.newNote);
    case "note":
      return noteMenuItems(
        { path: menu.path, ...props.note.facts(menu.path) },
        props.note.actions,
      );
    case "editor":
      return editorMenuItems({ selected: menu.selected }, props.editor);
    case "gear":
      return gearMenuItems(props.gear.facts, props.gear.actions);
    case "tag":
      return tagMenuItems(
        { tag: menu.tag, filtered: props.tag.filtered(menu.tag) },
        props.tag.actions,
      );
    case "folder":
      return folderMenuItems(
        { folder: menu.folder, ...props.folder.facts(menu.folder) },
        props.folder.actions,
      );
    case "outline":
      return outlineMenuItems({
        onMove: (delta) => props.outline.onMove(menu.from, delta),
      });
    case "trash":
      return trashMenuItems(menu.path, props.trash);
  }
}

/// 歯車のメニューの横幅。CSS の .context-menu と揃える（測って置くのではなく
/// 下端を歯車に合わせるので、横だけ数字が要る）
const GEAR_MENU_WIDTH = 230;

export function AppContextMenus({
  menu,
  onClose,
  ...props
}: AppContextMenusProps) {
  if (menu === null) return null;
  const list = <MenuList onPick={onClose} items={itemsFor(menu, props)} />;
  if (menu.kind === "gear") {
    // 参照実装（ui/menus.build_gear_menu）と同じ考え方: **メニューバーと同じ
    // 動作を使い回し、よく使うものだけ**。歯車は下端にあるので、押した絵の
    // 真上に出して上へ伸ばす（lib/context-menu の anchorAbove）
    return (
      <div
        className="menu-backdrop"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <ul
          role="menu"
          className="context-menu"
          style={anchorAbove(menu, GEAR_MENU_WIDTH, {
            width: window.innerWidth,
            height: window.innerHeight,
          })}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {list}
        </ul>
      </div>
    );
  }
  return (
    <ContextMenu at={menu} onClose={onClose}>
      {list}
    </ContextMenu>
  );
}
