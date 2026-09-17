// 「最新値の ref」。一度だけ登録するハンドラや非同期の後始末が、描き直しの
// たびに変わる値を読むための箱。App と useNoteSync に同じ 2 行が 10 組あった
// （棚卸し 2026-09-17）。描画中に current を書くのは意図（次の描画を待たない）

import { useRef, type MutableRefObject } from "react";

export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
