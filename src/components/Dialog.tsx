// ダイアログの殻（19-3）。背景を押すと閉じる・中を押しても閉じない・見出し。
// 8 つの窓が同じ 3 層の div を各自で書いていた。**Esc と focus trap はまだ無い** —
// 足すならここ 1 か所（PromptDialog などは入力欄で Esc を見ている）

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export type DialogProps = {
  /// 読み上げの名前（aria-label）。省けば title の字
  label?: string;
  /// 見出し（無い窓もある: 曖昧検索の入力欄がそのまま頭）
  title?: ReactNode;
  /// `palette` に足すクラス
  className?: string;
  /// 背景を押したとき。**省くと背景では閉じない**（選ばずに済ませられない問い）
  onClose?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

export function Dialog({
  label,
  title,
  className,
  onClose,
  onKeyDown,
  children,
}: DialogProps) {
  const name = label ?? (typeof title === "string" ? title : undefined);
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className={className ? `palette ${className}` : "palette"}
        role="dialog"
        aria-label={name}
        onMouseDown={
          onClose ? (event: MouseEvent) => event.stopPropagation() : undefined
        }
        onKeyDown={onKeyDown}
      >
        {title !== undefined && (
          <header className="palette-title">{title}</header>
        )}
        {children}
      </div>
    </div>
  );
}
