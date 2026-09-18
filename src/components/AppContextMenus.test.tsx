// @vitest-environment jsdom
// 右クリックのメニュー 8 種の枠（20-2）。**どれが開いているか → 枠と項目**
// だけを見る。項目の判断は各 *-menu のテスト、押したあとの動きは App。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  AppContextMenus,
  menuOpener,
  type AppContextMenusProps,
  type OpenMenu,
} from "./AppContextMenus";

function props(menu: OpenMenu | null): AppContextMenusProps {
  return {
    menu,
    onClose: vi.fn(),
    newNote: { onTemplate: vi.fn(), onDaily: vi.fn() },
    note: {
      facts: vi.fn(() => ({ pinned: false, hiddenFromMcp: false })),
      actions: {
        onPin: vi.fn(),
        onToggleMcpHidden: vi.fn(),
        onOpenBeside: vi.fn(),
        onDuplicate: vi.fn(),
        onMove: vi.fn(),
        onSaveTemplate: vi.fn(),
        onCopyLink: vi.fn(),
        onReveal: vi.fn(),
        onTrash: vi.fn(),
      },
    },
    editor: {
      onClipboard: vi.fn(),
      onFormat: vi.fn(),
      onInsertTable: vi.fn(),
      onHandOff: vi.fn(),
      onDictionary: vi.fn(),
    },
    gear: {
      facts: {
        treesVisible: true,
        notesVisible: true,
        outlineOpen: false,
        assistantEnabled: true,
        assistantOpen: false,
        sourceMode: false,
        wysiwygMode: false,
        focus: false,
        typewriter: false,
      },
      actions: {
        onPreferences: vi.fn(),
        onToggleTrees: vi.fn(),
        onToggleNotes: vi.fn(),
        onToggleOutline: vi.fn(),
        onToggleAssistant: vi.fn(),
        onInlineMode: vi.fn(),
        onSourceMode: vi.fn(),
        onPreviewMode: vi.fn(),
        onFocusMode: vi.fn(),
        onTypewriter: vi.fn(),
      },
    },
    tag: {
      filtered: (tag) => tag === "絞り中",
      actions: {
        onFilter: vi.fn(),
        onSearch: vi.fn(),
        onCopy: vi.fn(),
        onRename: vi.fn(),
      },
    },
    folder: {
      facts: vi.fn(() => ({ hiddenFromMcp: false })),
      actions: {
        onNewNote: vi.fn(),
        onNewFolder: vi.fn(),
        onReveal: vi.fn(),
        onToggleMcpHidden: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      },
    },
    outline: { onMove: vi.fn() },
    trash: {
      onReveal: vi.fn(),
      onEmpty: vi.fn(),
      onRestore: vi.fn(),
      onDeleteForever: vi.fn(),
    },
  };
}

const at = { x: 10, y: 20 };

describe("AppContextMenus", () => {
  test("test_閉じているときは何も描かない", () => {
    render(<AppContextMenus {...props(null)} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test.each<[OpenMenu, string]>([
    [{ kind: "new", ...at }, "テンプレートから新規…"],
    [{ kind: "note", path: "/v/a.md", ...at }, "フォルダへ移動…"],
    [{ kind: "editor", selected: true, ...at }, "切り取り"],
    [{ kind: "gear", left: 4, top: 700 }, "環境設定…"],
    [{ kind: "tag", tag: "旅", ...at }, "タグ名をコピー"],
    [{ kind: "folder", folder: "日記", ...at }, "新規フォルダ…"],
    [{ kind: "outline", from: 12, ...at }, "この節を上へ動かす"],
    [{ kind: "trash", path: null, ...at }, "ゴミ箱を空にする…"],
  ])("test_種類ごとにその項目が並ぶ %#", (menu, label) => {
    render(<AppContextMenus {...props(menu)} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  test("test_対象の今の姿は_facts_で引く", () => {
    const p = props({ kind: "note", path: "/v/a.md", ...at });
    render(<AppContextMenus {...p} />);
    expect(p.note.facts).toHaveBeenCalledWith("/v/a.md");
  });

  test("test_項目を押すと_まず閉じてから_対象を添えて動く", () => {
    const p = props({ kind: "note", path: "/v/a.md", ...at });
    render(<AppContextMenus {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "複製" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.note.actions.onDuplicate).toHaveBeenCalledWith("/v/a.md");
  });

  test("test_目次の節を動かすときは_どの節かを添える", () => {
    const p = props({ kind: "outline", from: 12, ...at });
    render(<AppContextMenus {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "この節を下へ動かす" }));
    expect(p.outline.onMove).toHaveBeenCalledWith(12, 1);
  });

  test("test_絞り込み中のタグは解除の項目になる", () => {
    render(
      <AppContextMenus {...props({ kind: "tag", tag: "絞り中", ...at })} />,
    );
    expect(screen.getByRole("button", { name: /解除/ })).toBeTruthy();
  });

  test("test_歯車は押した絵の真上に下端を合わせて出る", () => {
    const p = props({ kind: "gear", left: 4, top: 700 });
    render(<AppContextMenus {...p} />);
    const menu = screen.getByRole("menu");
    expect(menu.style.bottom).not.toBe("");
    expect(menu.style.top).toBe("");
    // 外側を押すと閉じる
    fireEvent.mouseDown(menu.parentElement as HTMLElement);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  test("test_menuOpener_は種類を足して開く", () => {
    const set = vi.fn();
    menuOpener(set, "trash")({ path: "/v/.trash/a.md", x: 1, y: 2 });
    expect(set).toHaveBeenCalledWith({
      kind: "trash",
      path: "/v/.trash/a.md",
      x: 1,
      y: 2,
    });
  });
});
