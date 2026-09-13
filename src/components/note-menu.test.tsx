// ノートの右クリックに並ぶもの（15-7）。**判断だけを見る** — 描くのは
// MenuList、押したときに何が起きるかは App。

import { describe, expect, test, vi } from "vitest";
import {
  folderMenuItems,
  noteMenuItems,
  trashMenuItems,
  type FolderMenuActions,
  type NoteMenuActions,
  type TrashMenuActions,
} from "./note-menu";

const actions = (): NoteMenuActions => ({
  onPin: vi.fn(),
  onToggleMcpHidden: vi.fn(),
  onOpenBeside: vi.fn(),
  onDuplicate: vi.fn(),
  onMove: vi.fn(),
  onSaveTemplate: vi.fn(),
  onCopyLink: vi.fn(),
  onReveal: vi.fn(),
  onTrash: vi.fn(),
});

const labels = (items: ReturnType<typeof noteMenuItems>) =>
  items.flatMap((entry) => ("label" in entry ? [entry.label] : []));

const find = (items: ReturnType<typeof noteMenuItems>, label: string) =>
  items.find((entry) => "label" in entry && entry.label === label);

describe("noteMenuItems", () => {
  test("test_ピン留め中は_外す_と出て_捨てられない理由を見せる", () => {
    const items = noteMenuItems(
      { path: "/v/a.md", pinned: true, hiddenFromMcp: false },
      actions(),
    );
    expect(labels(items)).toContain("ピンを外す");
    const trash = find(items, "ゴミ箱へ移動");
    // **項目を消さない。** 消すと理由が分からない（G-3）
    expect(trash && "disabled" in trash && trash.disabled).toBe(true);
    expect(trash && "title" in trash && trash.title).toBe(
      "ピン留め中は捨てられません",
    );
  });

  test("test_ピンが無ければ捨てられる", () => {
    const items = noteMenuItems(
      { path: "/v/a.md", pinned: false, hiddenFromMcp: false },
      actions(),
    );
    expect(labels(items)).toContain("ピン留め");
    const trash = find(items, "ゴミ箱へ移動");
    expect(trash && "disabled" in trash && trash.disabled).toBe(false);
    expect(trash && "danger" in trash && trash.danger).toBe(true);
  });

  test("test_渡さない場所なら_渡す_に変わる", () => {
    const hidden = noteMenuItems(
      { path: "/v/a.md", pinned: false, hiddenFromMcp: true },
      actions(),
    );
    expect(labels(hidden)).toContain("Claude に渡す");
    const shown = noteMenuItems(
      { path: "/v/a.md", pinned: false, hiddenFromMcp: false },
      actions(),
    );
    expect(labels(shown)).toContain("Claude に渡さない");
  });

  test("test_押すと対象のノートを渡して呼ぶ", () => {
    const act = actions();
    const items = noteMenuItems(
      { path: "/v/a.md", pinned: false, hiddenFromMcp: false },
      act,
    );
    const trash = find(items, "ゴミ箱へ移動");
    if (trash && "onSelect" in trash) trash.onSelect();
    expect(act.onTrash).toHaveBeenCalledWith("/v/a.md");
  });
});

const folderActions = (): FolderMenuActions => ({
  onNewNote: vi.fn(),
  onNewFolder: vi.fn(),
  onReveal: vi.fn(),
  onToggleMcpHidden: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
});

describe("folderMenuItems", () => {
  test("test_保管フォルダの直下では_作るものだけ出す", () => {
    // 名前も変えられないし消せない。渡す / 渡さないも出さない
    const items = folderMenuItems(
      { folder: "", hiddenFromMcp: false },
      folderActions(),
    );
    expect(labels(items)).toEqual([
      "新規ノート",
      "新規フォルダ…",
      "Finder で開く",
    ]);
  });

  test("test_ふつうのフォルダでは改名と削除まで出す", () => {
    const items = folderMenuItems(
      { folder: "仕事", hiddenFromMcp: false },
      folderActions(),
    );
    expect(labels(items)).toContain("名前を変更…");
    const remove = items.find(
      (entry) => "label" in entry && entry.label === "削除",
    );
    expect(remove && "danger" in remove && remove.danger).toBe(true);
  });

  test("test_渡さない場所なら_渡す_に変わる", () => {
    const items = folderMenuItems(
      { folder: "秘密", hiddenFromMcp: true },
      folderActions(),
    );
    expect(labels(items)).toContain("Claude に渡す");
  });
});

const trashActions = (): TrashMenuActions => ({
  onReveal: vi.fn(),
  onEmpty: vi.fn(),
  onRestore: vi.fn(),
  onDeleteForever: vi.fn(),
});

describe("trashMenuItems", () => {
  test("test_ゴミ箱の行では_空にする", () => {
    const items = trashMenuItems(null, trashActions());
    expect(labels(items)).toEqual(["Finder で開く", "ゴミ箱を空にする…"]);
  });

  test("test_捨てたノートの上では_戻す_と_完全に削除", () => {
    const items = trashMenuItems("/v/.trash/a.md", trashActions());
    expect(labels(items)).toEqual(["Finder で開く", "元に戻す", "完全に削除"]);
    const forever = items.find(
      (entry) => "label" in entry && entry.label === "完全に削除",
    );
    expect(forever && "danger" in forever && forever.danger).toBe(true);
  });
});
