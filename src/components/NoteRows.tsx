// ノート一覧の行。開く・右クリック・フォルダへ掴んで落とす（要望 2026-09-04）。
// 掴んでいる間の札（drag-ghost）はこの部品だけが持つ。

import { useRef } from "react";
import { NOTE_DRAG_TYPE } from "../lib/note-drop";
import { draggedNotes, encodeNoteDrag } from "../lib/note-selection";
import { formatStamp, type NoteEntry } from "../lib/note-order";
import { labelFolder, noteStem } from "../lib/note-path";

export type NoteRowsProps = {
  notes: readonly NoteEntry[];
  currentPath: string | null;
  /// 1 件も無いときの案内。null なら何も出さない（絞っていないとき）
  emptyText: string | null;
  onOpen: (path: string) => void;
  onMenu: (at: { path: string; x: number; y: number }) => void;
  /// 掴んだ（落とし先の判定に使うので親が覚える）。複数選択なら全部
  onDragStart: (paths: string[]) => void;
  onDragEnd: () => void;
  /// 複数選択（要望 2026-09-10）。Cmd+クリックで足し外し、Shift+クリックで範囲
  selected: ReadonlySet<string>;
  onToggleSelect: (path: string) => void;
  onRangeSelect: (path: string) => void;
};

export function NoteRows({
  notes,
  currentPath,
  emptyText,
  onOpen,
  onMenu,
  onDragStart,
  onDragEnd,
  selected,
  onToggleSelect,
  onRangeSelect,
}: NoteRowsProps) {
  /// 掴んだときに持ち歩く札。**行そのものを絵にしない** — WebKit は行の
  /// 載っている層ごと写し取るので、窓の幅いっぱいの帯になって隣のペインの
  /// 本文まで一緒に動く（実機で発覚 2026-09-04）
  const ghost = useRef<HTMLElement | null>(null);
  return (
    <ul className="note-rows">
      {emptyText !== null && notes.length === 0 && (
        <li className="no-hits">{emptyText}</li>
      )}
      {notes.map((entry) => (
        <li key={entry.path}>
          <button
            className={
              `note-row${entry.path === currentPath ? " selected" : ""}` +
              (selected.has(entry.path) ? " checked" : "")
            }
            draggable
            onDragStart={(event) => {
              // 選んでいる行を掴んだら選んでいる全部（要望 2026-09-10）
              const paths = draggedNotes(
                notes.map((note) => note.path),
                selected,
                entry.path,
              );
              onDragStart(paths);
              // 動かすのであって写しではない（緑の + を出さない）
              event.dataTransfer.effectAllowed = "move";
              // **載せるのは目印だけ。** 素の文字を載せると本文や入力欄が
              // 「文字のコピー」として受け、緑の + が付くうえ、落とすと題名が
              // 本文に入る（実機報告 2026-09-04）
              event.dataTransfer.setData(NOTE_DRAG_TYPE, encodeNoteDrag(paths));
              // 画面の外で作った札を絵にする。**画面に載っていないと写し取って
              // もらえない**ので、消すのは掴み終わってから（dragend）
              const made = document.createElement("div");
              made.className = "drag-ghost";
              made.textContent =
                paths.length > 1
                  ? `${paths.length} 件のノート`
                  : noteStem(entry.path);
              document.body.appendChild(made);
              ghost.current = made;
              event.dataTransfer.setDragImage(made, 12, 12);
            }}
            onDragEnd={() => {
              ghost.current?.remove();
              ghost.current = null;
              onDragEnd();
            }}
            onClick={(event) => {
              // 修飾キーは選択の操作。開かない
              if (event.metaKey || event.ctrlKey) {
                onToggleSelect(entry.path);
                return;
              }
              if (event.shiftKey) {
                onRangeSelect(entry.path);
                return;
              }
              onOpen(entry.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu({ path: entry.path, x: event.clientX, y: event.clientY });
            }}
          >
            {/* 題名・冒頭・フォルダ・日付の 4 段（要望 2026-09-07）。題名は
              ファイル名の幹だけにして、フォルダは自分の段に出す */}
            <span className="note-row-title">
              {entry.pinned && <span className="pin-mark">📌</span>}
              {noteStem(entry.path)}
            </span>
            {entry.preview && (
              <span className="note-row-preview">{entry.preview}</span>
            )}
            {labelFolder(entry.label) && (
              <span className="note-row-folder">
                {labelFolder(entry.label)}
              </span>
            )}
            <span className="note-row-stamp">{formatStamp(entry.mtimeMs)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
