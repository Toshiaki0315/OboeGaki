// 名前や日付を 1 つ聞く窓。フォルダの作成・改名（ADR-0024）、検索の保存、
// テンプレートへの登録、日付を選んで開く（7-5）が同じ形なので 1 つにする。
// 打った値は **入力欄だけが持つ**（打鍵ごとに親を描き直さない）。

import { useMemo, useRef } from "react";
import { imeEnterGuard } from "../lib/ime";

export type PromptDialogProps = {
  title: string;
  label: string;
  defaultValue?: string;
  type?: "text" | "date";
  /// 欄の下に添える説明
  note?: string;
  confirmLabel: string;
  /// 前後の空白を落とした値。空のときは呼ばれない（窓も閉じない）
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export function PromptDialog({
  title,
  label,
  defaultValue,
  type = "text",
  note,
  confirmLabel,
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  // 変換中の Enter は IME の確定（T5）。決定まで押すと、日本語の名前が
  // 確定と同時に通ってしまう（実機報告 2026-09-08）。見分け方は lib/ime
  const ime = useMemo(() => imeEnterGuard(), []);

  function confirm() {
    const value = input.current?.value.trim() ?? "";
    if (!value) return;
    onConfirm(value);
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-title">{title}</header>
        <div className="table-dialog-fields">
          <label>
            {label}
            <input
              ref={input}
              type={type}
              autoFocus
              defaultValue={defaultValue}
              onCompositionEnd={(event) =>
                ime.onCompositionEnd(event.nativeEvent)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (!ime.isImeEnter(event.nativeEvent)) confirm();
                } else if (event.key === "Escape") onClose();
              }}
            />
          </label>
        </div>
        {note && <p className="dialog-text">{note}</p>}
        <div className="dialog-actions">
          <button onClick={onClose}>やめる</button>
          <button className="primary" onClick={confirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
