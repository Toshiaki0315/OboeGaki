// 題名の欄。題名はファイル名の幹（ADR-0005）で、書き換えると改名になる。
// 改名は onBlur に一本化する（Enter でも呼ぶと二重発火）。

import { noteStem } from "../lib/note-path";

export function NoteTitle({
  path,
  onRename,
}: {
  path: string;
  onRename: (name: string) => void;
}) {
  return (
    <header className="note-header">
      <input
        className="title-input"
        defaultValue={noteStem(path)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={(event) => onRename(event.currentTarget.value)}
      />
    </header>
  );
}
