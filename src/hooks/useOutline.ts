// 目次（アウトライン）と統計（19-4 で App.tsx から切り出した）。
// **隠れているときは数えない**（ADR-0022）。**打鍵ごとには数えない** — 全文の走査は
// 16ms の予算を食うので、打ち終わってから 300ms 置いてまとめて数える。
// 本文は EditorView から読む（T2）。ここは「いつ数えるか」だけを持つ

import { useEffect, useMemo, useState } from "react";
import type { OutlineItem } from "../editor/outline";
import type { TextStats } from "../editor/stats";
import { createDebouncer } from "../lib/debounce";
import { useLatest } from "./useLatest";

const EMPTY_STATS: TextStats = { characters: 0, lines: 0 };

export type OutlineInput = {
  /// 目次のペインが出ているか
  open: boolean;
  /// 開いているノートの識別（変わったら数え直す）
  doc: string | null;
  currentPath: string | null;
  getOutline: () => OutlineItem[];
  getStats: () => TextStats;
};

export function useOutline(input: OutlineInput) {
  const latest = useLatest(input);
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [cursorPos, setCursorPos] = useState(0);
  const [stats, setStats] = useState<TextStats>(EMPTY_STATS);
  const outlineSoon = useMemo(() => createDebouncer(300), []);
  const statsSoon = useMemo(() => createDebouncer(300), []);

  // 隠れているときは数えない（ADR-0022）
  useEffect(() => {
    if (!input.open) {
      setItems([]);
      return;
    }
    setItems(latest.current.getOutline());
  }, [input.open, input.doc, input.currentPath, latest]);

  // ノートを開いたら数え直す。**エディタが立ち上がったあと**に数える
  // （子の mount → 親の effect の順なので、ここでは既に新しい内容）
  useEffect(() => {
    statsSoon.cancel();
    setStats(latest.current.getStats());
  }, [input.doc, input.currentPath, statsSoon, latest]);

  /// 本文が変わった（打鍵）。目次は出ているときだけ、統計はいつも、300ms 置いて
  function docChanged() {
    if (latest.current.open) {
      outlineSoon.schedule(() => setItems(latest.current.getOutline()));
    }
    statsSoon.schedule(() => setStats(latest.current.getStats()));
  }

  /// キャレットが動いた。目次が出ているときだけ現在地を追う
  function cursorMoved(pos: number) {
    if (latest.current.open) setCursorPos(pos);
  }

  // 現在地: キャレット位置以前の最後の見出し
  let currentIndex = -1;
  items.forEach((item, index) => {
    if (item.from <= cursorPos) currentIndex = index;
  });

  return { items, stats, cursorPos, currentIndex, docChanged, cursorMoved };
}
