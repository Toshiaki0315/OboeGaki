// @vitest-environment jsdom
// ノート一覧の行（開く・右クリック・フォルダへ掴んで落とす）の検証。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NOTE_DRAG_TYPE } from "../lib/note-drop";
import { NoteRows, type NoteRowsProps } from "./NoteRows";

afterEach(cleanup);

const NOTES = [
  {
    path: "/v/a.md",
    label: "a",
    preview: "冒頭の一文",
    mtimeMs: 0,
    pinned: true,
  },
  { path: "/v/b.md", label: "b", preview: "", mtimeMs: 0, pinned: false },
  {
    path: "/v/仕事/会議/議事録.md",
    label: "仕事/会議/議事録",
    preview: "決めたこと",
    mtimeMs: 0,
    pinned: false,
  },
];

function setup(over: Partial<NoteRowsProps> = {}) {
  const props: NoteRowsProps = {
    notes: NOTES,
    currentPath: "/v/b.md",
    emptyText: null,
    onOpen: vi.fn(),
    onMenu: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    selected: new Set<string>(),
    onToggleSelect: vi.fn(),
    onRangeSelect: vi.fn(),
    isHiddenFromMcp: () => false,
    ...over,
  };
  const view = render(<NoteRows {...props} />);
  return { props, view };
}

describe("NoteRows", () => {
  test("test_題_ピンの印_冒頭_開いている印", () => {
    const { view } = setup();
    expect(screen.getByText("冒頭の一文")).toBeTruthy();
    expect(view.container.querySelectorAll(".pin-mark")).toHaveLength(1);
    expect(screen.getByText("b").closest("button")?.className).toContain(
      "selected",
    );
  });

  test("test_Claude に渡さないノートには印が出る（15-6）", () => {
    // 右クリックしないと分からない、では安心して使えない
    const { view } = setup({
      isHiddenFromMcp: (path) => path === "/v/a.md",
    });
    const marks = view.container.querySelectorAll(".mcp-hidden-mark");
    expect(marks).toHaveLength(1);
    expect(screen.getByText("a").closest("button")?.textContent).toContain("a");
    expect(marks[0].getAttribute("title")).toContain("Claude");
  });

  test("test_行は題名_冒頭_フォルダ_日付の 4 段（要望 2026-09-07）", () => {
    const { view } = setup();
    // 題名はファイル名の幹だけ（フルパスを 1 行目に詰め込まない）
    const row = screen.getByText("議事録").closest("button")!;
    expect(row.querySelector(".note-row-title")?.textContent).toBe("議事録");
    expect(row.querySelector(".note-row-preview")?.textContent).toBe(
      "決めたこと",
    );
    expect(row.querySelector(".note-row-folder")?.textContent).toBe(
      "仕事/会議",
    );
    expect(row.querySelector(".note-row-stamp")).toBeTruthy();
    expect(Array.from(row.children).map((child) => child.className)).toEqual([
      "note-row-title",
      "note-row-preview",
      "note-row-folder",
      "note-row-stamp",
    ]);
    // 直下のノートにはフォルダの行を出さない
    expect(view.container.querySelectorAll(".note-row-folder")).toHaveLength(1);
  });

  test("test_押すと開き_右クリックで親に知らせる", () => {
    const { props } = setup();
    fireEvent.click(screen.getByText("a"));
    expect(props.onOpen).toHaveBeenCalledWith("/v/a.md");
    fireEvent.contextMenu(screen.getByText("b"), { clientX: 7, clientY: 8 });
    expect(props.onMenu).toHaveBeenCalledWith({ path: "/v/b.md", x: 7, y: 8 });
  });

  test("test_掴むと目印だけを載せ_札を作り_放すと札を消す", () => {
    const { props } = setup();
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    const row = screen.getByText("a").closest("button")!;
    fireEvent.dragStart(row, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      NOTE_DRAG_TYPE,
      "/v/a.md",
    );
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(document.querySelector(".drag-ghost")?.textContent).toBe("a");
    expect(props.onDragStart).toHaveBeenCalledWith(["/v/a.md"]);
    fireEvent.dragEnd(row);
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(props.onDragEnd).toHaveBeenCalledTimes(1);
  });

  test("test_Cmd+クリックで選択を切り替え_Shift+クリックで範囲_ふつうのクリックは開く（要望 2026-09-10）", () => {
    const { props } = setup();
    const a = screen.getByText("a").closest("button")!;
    fireEvent.click(a, { metaKey: true });
    expect(props.onToggleSelect).toHaveBeenCalledWith("/v/a.md");
    expect(props.onOpen).not.toHaveBeenCalled();
    fireEvent.click(a, { shiftKey: true });
    expect(props.onRangeSelect).toHaveBeenCalledWith("/v/a.md");
    fireEvent.click(a);
    expect(props.onOpen).toHaveBeenCalledWith("/v/a.md");
  });

  test("test_選んでいる行には印が付く", () => {
    setup({ selected: new Set(["/v/a.md", "/v/b.md"]) });
    expect(screen.getByText("a").closest("button")!.className).toContain(
      "checked",
    );
    expect(
      screen.getByText("議事録").closest("button")!.className,
    ).not.toContain("checked");
  });

  test("test_選んでいる行を掴むと選んでいる全部を載せ_札は件数", () => {
    const { props } = setup({ selected: new Set(["/v/a.md", "/v/b.md"]) });
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    fireEvent.dragStart(screen.getByText("a").closest("button")!, {
      dataTransfer,
    });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      NOTE_DRAG_TYPE,
      "/v/a.md\n/v/b.md",
    );
    expect(props.onDragStart).toHaveBeenCalledWith(["/v/a.md", "/v/b.md"]);
    expect(document.querySelector(".drag-ghost")?.textContent).toBe(
      "2 件のノート",
    );
    fireEvent.dragEnd(screen.getByText("a").closest("button")!);
  });

  test("test_空のときの案内は親の言葉で", () => {
    setup({ notes: [], emptyText: "このタグのノートはありません" });
    expect(screen.getByText("このタグのノートはありません")).toBeTruthy();
  });
});
