// 節ごと動かす（TASKS 7-1。ポメラのアウトラインの「見出しごと入れ替え」）。
//
// **見出しの行から、次の同じか浅い見出しの手前まで**を 1 かたまりとして、
// 前後の兄弟と入れ替える。配下の深い見出しは一緒に動く。
//
// **親から飛び出さない。** `### A-1` を上げても `## A` の前には出さない
// （出せてしまうと、動かしたつもりが別の節の中身になる）。

import type { EditorState, ChangeSpec } from "@codemirror/state";
import { outlineOf } from "./outline";

/// 節の範囲（見出しの行頭から、次の同じか浅い見出しの手前まで）。
function sectionEnd(
  state: EditorState,
  items: readonly { level: number; from: number }[],
  index: number,
): number {
  const level = items[index].level;
  for (let next = index + 1; next < items.length; next += 1) {
    if (items[next].level <= level) return items[next].from;
  }
  return state.doc.length;
}

export type SectionMove = {
  changes: ChangeSpec;
  /// 動かしたあとの見出しの位置（キャレットを置く先）。
  headingAt: number;
};

/// 節を 1 つ上（-1）か下（+1）へ動かす変更。動かせないときは null。
///
/// 入れ替えるのは**同じ深さの隣**だけ。間に深い見出しがあっても、それは
/// 相手の節の中身なので一緒に動く。
export function moveSection(
  state: EditorState,
  headingFrom: number,
  delta: -1 | 1,
): SectionMove | null {
  const items = outlineOf(state);
  const index = items.findIndex((item) => item.from === headingFrom);
  if (index < 0) return null;
  const level = items[index].level;

  // 相手を探す。**同じ深さの隣**（浅い見出しに当たったらそこで打ち切り）
  let partner = -1;
  if (delta === 1) {
    for (let next = index + 1; next < items.length; next += 1) {
      if (items[next].level < level) break;
      if (items[next].level === level) {
        partner = next;
        break;
      }
    }
  } else {
    for (let prev = index - 1; prev >= 0; prev -= 1) {
      if (items[prev].level < level) break;
      if (items[prev].level === level) {
        partner = prev;
        break;
      }
    }
  }
  if (partner < 0) return null;

  const first = Math.min(index, partner);
  const second = Math.max(index, partner);
  const from = items[first].from;
  const middle = items[second].from;
  const to = sectionEnd(state, items, second);
  const head = state.sliceDoc(from, middle);
  const tail = state.sliceDoc(middle, to);
  // **文末の改行は動かさない。** 末尾の節を動かすと改行が中へ入り、
  // 文書の終わりから改行が消える（差分が汚れる）
  const cut = /\n*$/.exec(tail)?.[0] ?? "";
  const body = tail.slice(0, tail.length - cut.length);
  const glue = /\n*$/.exec(head)?.[0] ?? "";
  return {
    changes: {
      from,
      to,
      insert: `${body}${glue}${head.slice(0, head.length - glue.length)}${cut}`,
    },
    // 入れ替えたので、先にあったほうは body と glue の分だけ後ろへ動く
    headingAt: index === first ? from + body.length + glue.length : from,
  };
}
