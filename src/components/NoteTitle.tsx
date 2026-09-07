// 題名の欄。題名はファイル名の幹（ADR-0005）で、書き換えると改名になる。
// 改名は onBlur に一本化する（Enter でも呼ぶと二重発火）。

import { useMemo } from "react";
import { imeEnterGuard } from "../lib/ime";
import { noteStem } from "../lib/note-path";

export function NoteTitle({
  path,
  onRename,
}: {
  path: string;
  onRename: (name: string) => void;
}) {
  // 変換中の Enter は IME の確定（T5）。外すと確定と同時に改名が走る
  // （実機報告 2026-09-07）。見分け方は lib/ime
  const ime = useMemo(() => imeEnterGuard(), []);
  return (
    <header className="note-header">
      <input
        className="title-input"
        defaultValue={noteStem(path)}
        onCompositionEnd={(event) => ime.onCompositionEnd(event.nativeEvent)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !ime.isImeEnter(event.nativeEvent)) {
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => onRename(event.currentTarget.value)}
      />
    </header>
  );
}
