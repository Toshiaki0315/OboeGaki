// 右クリックのメニューの枠と枝。置き場所の計算は lib/context-menu に任せ、
// ここは測って置き直す取り回しだけを持つ。中身（項目）は呼び出し側が並べる。

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { menuPosition } from "../lib/context-menu";

/// 右クリックのメニュー（枠と置き場所）。
///
/// **高さを見積もらない。** 項目が増えるたびに見積もりを直すことになり、
/// 直し忘れると窓の下で切れて**最後の項目が押せなくなる**（実機報告
/// 2026-09-05）。出してから測って置き直す。
/// 画面より高いメニューは、そのまま中で送れるようにする（CSS の max-height）。
export function ContextMenu({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const spot = menuPosition(
      at,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced({ left: spot.x, top: spot.y });
  }, [at]);
  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <ul
        ref={list}
        role="menu"
        className="context-menu"
        // 測るまでは押した場所に置き、置き場所が決まるまで見せない
        // （一瞬ずれた場所に出るのを避ける）
        style={{
          left: placed?.left ?? at.x,
          top: placed?.top ?? at.y,
          visibility: placed ? "visible" : "hidden",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </ul>
    </div>
  );
}

/// 右クリックのメニューの中の枝（要望 2026-09-05）。
///
/// **`position: fixed` で出す。** 親のメニューは高いときに中で送れるよう
/// `overflow` を持っているので、その中に置くと枝が切られる。固定なら
/// 親の外に出られる。右端で開いたときは左へ返す。
export function SubMenu({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const item = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // 希望の位置（項目の横）と、測って決めた置き場所を分けて持つ
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );
  const place = () => {
    const box = item.current?.getBoundingClientRect();
    if (!box) return;
    // 横は開く向きだけ決める（右端なら左へ返す）。**縦は測ってから**
    const flip = box.right + SUBMENU_WIDTH > window.innerWidth;
    setAt({
      // 少し重ねる（親から枝へマウスを移すときに間で切れない）
      left: flip ? box.left - SUBMENU_WIDTH + 4 : box.right - 4,
      top: box.top - 4,
    });
  };
  // **枝も高さを見積もらない。** 窓の下のほうで開くと、下が切れて最後の
  // 相手が押せなくなる（実機報告 2026-09-05）
  useLayoutEffect(() => {
    if (!at) {
      setPlaced(null);
      return;
    }
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const spot = menuPosition(
      { x: at.left, y: at.top },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced({ left: spot.x, top: spot.y });
  }, [at]);
  return (
    <li
      ref={item}
      className="has-submenu"
      onMouseEnter={place}
      onFocus={place}
      onMouseLeave={() => setAt(null)}
    >
      <button type="button">
        {icon}
        {label}
        <span className="submenu-arrow" aria-hidden="true">
          ▶
        </span>
      </button>
      {at && (
        <ul
          ref={list}
          role="menu"
          className="context-menu context-submenu"
          style={{
            ...(placed ?? at),
            visibility: placed ? "visible" : "hidden",
          }}
        >
          {children}
        </ul>
      )}
    </li>
  );
}

/// 枝の幅（置く向きを決めるのに使う）。CSS の `min-width` と揃える。
const SUBMENU_WIDTH = 176;
