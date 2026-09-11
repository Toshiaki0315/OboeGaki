// どこからでも書き取り（ADR-0057 / 12-6）の小さな窓。本文だけ。
// Cmd+Enter で今日のノートの末尾へ、Esc で捨てる。**素の textarea** —
// 書き取りは数行で、CM6 を起こすほどではない。IME は OS の素の動き

import { useEffect, useRef, useState } from "react";

export function CaptureWindow({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => void;
  /// Esc。書いていたものを渡す（親が「捨てるか」を聞く）
  onCancel: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <div className="capture-window">
      <textarea
        ref={box}
        aria-label="書き取り"
        className="capture-text"
        value={text}
        placeholder="思いついたことを。⌘+Enter で今日のノートへ"
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          // 変換中の Enter は IME の確定（T5）。textarea は既定で改行を
          // 入れるだけなので、送るのは修飾キー付きだけ
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (text.trim()) onSubmit(text);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel(text);
          }
        }}
      />
      <footer className="capture-hint">
        ⌘+Enter で今日のノートの末尾へ ／ Esc で閉じる
      </footer>
    </div>
  );
}
