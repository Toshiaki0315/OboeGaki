// @vitest-environment jsdom
// サイドバーのフォルダの節（ADR-0024 / 要望 2026-09-05）の検証。
// 見出しがそのまま保管フォルダの行、ゴミ箱もフォルダの中に置く。
// 落とし先の強調はこの節だけが持つ。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TRASH_FOLDER } from "../lib/finder";
import { NOTE_DRAG_TYPE } from "../lib/note-drop";
import {
  COLLAPSED_KEY,
  FolderSection,
  type FolderSectionProps,
} from "./FolderSection";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

afterEach(cleanup);

function setup(over: Partial<FolderSectionProps> = {}) {
  const props: FolderSectionProps = {
    folders: [
      { folder: "仕事", count: 3 },
      { folder: "仕事/会議", count: 1 },
    ],
    rootCount: 5,
    trashCount: 2,
    folderFilter: null,
    open: true,
    onToggle: vi.fn(),
    onFilter: vi.fn(),
    onFolderMenu: vi.fn(),
    onTrashMenu: vi.fn(),
    acceptsDrop: vi.fn(() => true),
    onDrop: vi.fn(),
    onDropTrash: vi.fn(),
    storage: memoryStorage(),
    ...over,
  };
  const view = render(<FolderSection {...props} />);
  return { props, view };
}

const transfer = (path = "/v/a.md") => ({
  types: [NOTE_DRAG_TYPE],
  getData: () => path,
  dropEffect: "",
});

describe("FolderSection", () => {
  test("test_見出しに直下の件数_中のフォルダは 1 段下げて件数つき", () => {
    setup();
    expect(screen.getByText("5")).toBeTruthy();
    const child = screen.getByText("会議").closest("button")!;
    expect(child.style.paddingLeft).toBe(`${1.8 + 2 * 0.8}rem`);
    expect(
      screen.getByText("ゴミ箱").closest("button")!.style.paddingLeft,
    ).toBe("1.8rem");
  });

  test("test_子を持つフォルダにだけ三角が付き_畳むと中身が隠れる（要望 2026-09-08）", () => {
    const { props } = setup();
    expect(screen.getByText("会議")).toBeTruthy();
    const twist = screen.getByRole("button", { name: "「仕事」を畳む" });
    expect(screen.queryByRole("button", { name: /「会議」を/ })).toBeNull(); // 葉には無い
    fireEvent.click(twist);
    expect(screen.queryByText("会議")).toBeNull();
    expect(screen.getByText("仕事")).toBeTruthy(); // 本人は残る
    expect(props.onFilter).not.toHaveBeenCalled(); // 三角は絞らない
    fireEvent.click(screen.getByRole("button", { name: "「仕事」を開く" }));
    expect(screen.getByText("会議")).toBeTruthy();
  });

  test("test_畳んだ状態は覚える", () => {
    const storage = memoryStorage();
    setup({ storage });
    fireEvent.click(screen.getByRole("button", { name: "「仕事」を畳む" }));
    expect(storage.getItem(COLLAPSED_KEY)).toContain("仕事");
    cleanup();
    setup({ storage }); // 次の起動 = 同じ置き場所から読む
    expect(screen.queryByText("会議")).toBeNull();
  });

  test("test_名前を押すと絞り_もう一度で解除_見出しの名前は直下", () => {
    const { props } = setup();
    fireEvent.click(screen.getByText("仕事"));
    expect(props.onFilter).toHaveBeenCalledWith("仕事");
    fireEvent.click(screen.getByText("フォルダ"));
    expect(props.onFilter).toHaveBeenCalledWith("");
    cleanup();
    const again = setup({ folderFilter: "仕事" });
    fireEvent.click(screen.getByText("仕事"));
    expect(again.props.onFilter).toHaveBeenCalledWith(null);
  });

  test("test_ゴミ箱を押すと一覧が捨てたノートに変わる", () => {
    const { props } = setup();
    fireEvent.click(screen.getByText("ゴミ箱"));
    expect(props.onFilter).toHaveBeenCalledWith(TRASH_FOLDER);
    cleanup();
    const again = setup({ folderFilter: TRASH_FOLDER });
    fireEvent.click(screen.getByText("ゴミ箱"));
    expect(again.props.onFilter).toHaveBeenCalledWith(null);
  });

  test("test_三角（見出し）を押すと開閉は親_名前を押しても開閉しない", () => {
    const { props, view } = setup();
    fireEvent.click(view.container.querySelector("summary")!);
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("フォルダ"));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  test("test_右クリックはフォルダ名を_ゴミ箱は場所だけを知らせる", () => {
    const { props } = setup();
    fireEvent.contextMenu(screen.getByText("会議"), { clientX: 1, clientY: 2 });
    expect(props.onFolderMenu).toHaveBeenCalledWith({
      folder: "仕事/会議",
      x: 1,
      y: 2,
    });
    fireEvent.contextMenu(screen.getByText("フォルダ"), {
      clientX: 3,
      clientY: 4,
    });
    expect(props.onFolderMenu).toHaveBeenCalledWith({ folder: "", x: 3, y: 4 });
    fireEvent.contextMenu(screen.getByText("ゴミ箱"), {
      clientX: 5,
      clientY: 6,
    });
    expect(props.onTrashMenu).toHaveBeenCalledWith({ x: 5, y: 6 });
  });

  test("test_受けられる行に載せると強調し_落とすと親に渡して強調を消す", () => {
    const { props } = setup();
    const row = screen.getByText("仕事").closest("li")!;
    const button = screen.getByText("仕事").closest("button")!;
    fireEvent.dragEnter(row, { dataTransfer: transfer() });
    expect(button.className).toContain("drop-target");
    fireEvent.drop(row, { dataTransfer: transfer("/v/a.md") });
    expect(props.onDrop).toHaveBeenCalledWith("仕事", "/v/a.md");
    expect(button.className).not.toContain("drop-target");
  });

  test("test_受けられない行は強調しない", () => {
    setup({ acceptsDrop: () => false });
    const row = screen.getByText("仕事").closest("li")!;
    fireEvent.dragEnter(row, { dataTransfer: transfer() });
    expect(screen.getByText("仕事").closest("button")!.className).not.toContain(
      "drop-target",
    );
  });

  test("test_見出し（直下）にも落とせる", () => {
    const { props } = setup();
    const head = screen.getByText("フォルダ").closest("summary")!;
    fireEvent.dragEnter(head, { dataTransfer: transfer() });
    expect(head.className).toContain("drop-target");
    fireEvent.drop(head, { dataTransfer: transfer("/v/b.md") });
    expect(props.onDrop).toHaveBeenCalledWith("", "/v/b.md");
  });

  test("test_ゴミ箱に落とすと捨てる道へ", () => {
    const { props } = setup();
    const row = screen.getByText("ゴミ箱").closest("li")!;
    fireEvent.dragEnter(row, { dataTransfer: transfer() });
    expect(screen.getByText("ゴミ箱").closest("button")!.className).toContain(
      "drop-target",
    );
    fireEvent.drop(row, { dataTransfer: transfer("/v/c.md") });
    expect(props.onDropTrash).toHaveBeenCalledWith("/v/c.md");
  });

  test("test_窓のどこかで掴み終わったら強調は消える", () => {
    setup();
    const row = screen.getByText("仕事").closest("li")!;
    fireEvent.dragEnter(row, { dataTransfer: transfer() });
    fireEvent.dragEnd(document.body);
    expect(screen.getByText("仕事").closest("button")!.className).not.toContain(
      "drop-target",
    );
  });
});
