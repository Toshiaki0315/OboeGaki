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
    expect(props.onDragStart).toHaveBeenCalledWith("/v/a.md");
    fireEvent.dragEnd(row);
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(props.onDragEnd).toHaveBeenCalledTimes(1);
  });

  test("test_空のときの案内は親の言葉で", () => {
    setup({ notes: [], emptyText: "このタグのノートはありません" });
    expect(screen.getByText("このタグのノートはありません")).toBeTruthy();
  });
});
