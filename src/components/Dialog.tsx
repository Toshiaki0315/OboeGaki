// ダイアログの殻（19-3 / 20-1）。背景を押すと閉じる・中を押しても閉じない・見出し・
// Esc で閉じる・focus の面倒（開いたら中へ、Tab は中で回す、閉じたら元へ）。
// 9 つの窓が同じ 3 層の div を各自で書いていたのを 1 か所に寄せた。
// 閉じ方や focus の約束を変えるときはここだけ触る。

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

export type DialogProps = {
  /// 読み上げの名前（aria-label）。省けば title の字
  label?: string;
  /// 見出し（無い窓もある: 曖昧検索の入力欄がそのまま頭）
  title?: ReactNode;
  /// `palette` に足すクラス
  className?: string;
  /// 背景を押したとき・Esc を押したとき。**省くと背景でも Esc でも閉じない**
  /// （選ばずに済ませられない問い）
  onClose?: () => void;
  /// 中で押された鍵。Esc を自分で扱って閉じたくないときは preventDefault する
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function Dialog({
  label,
  title,
  className,
  onClose,
  onKeyDown,
  children,
}: DialogProps) {
  const name = label ?? (typeof title === "string" ? title : undefined);
  const root = useRef<HTMLDivElement>(null);

  // 開いたら中へ、閉じたら元へ。編集面（CM6）から窓を開いて閉じると、
  // 何もしなければ focus は body に落ちて、次の打鍵がどこにも届かない。
  // 開く前の場所を控えておいて戻す。呼び手が閉じ際に別の所へ移していたら
  // （ノートを開いて編集面へ、など）そちらを尊重する
  useEffect(() => {
    const previous = document.activeElement;
    const box = root.current;
    if (box && !box.contains(document.activeElement)) {
      // autoFocus が中に居ればそちらが先に取っているので奪わない
      focusables(box)[0]?.focus();
    }
    return () => {
      const active = document.activeElement;
      const lost = active === null || active === document.body;
      if (
        (lost || (box?.contains(active) ?? false)) &&
        previous instanceof HTMLElement
      ) {
        previous.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      // 変換中の Esc は IME の取り消し（T5）。窓を閉じるのは確定してから
      if (event.nativeEvent.isComposing || !onClose) return;
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab" && root.current) {
      const items = focusables(root.current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        ref={root}
        className={className ? `palette ${className}` : "palette"}
        role="dialog"
        aria-label={name}
        onMouseDown={
          onClose ? (event: MouseEvent) => event.stopPropagation() : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {title !== undefined && (
          <header className="palette-title">{title}</header>
        )}
        {children}
      </div>
    </div>
  );
}
