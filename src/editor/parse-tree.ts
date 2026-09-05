// 木を待って受け取る（2026-09-05）。
//
// **`syntaxTree` は時間で打ち切られる。** 木が未完成のまま返ると、届いて
// いない場所のノードが「無い」ことになる。目次から見出しが落ちる・
// 平文コピーに記号が残る・フォーカスモードが効かない・畳む印が消える、と
// 同じ穴を 4 か所で踏んだので、待ち方を 1 か所にまとめる。
//
// 待ちの上限は**まず当たらない大きさ**にしてある（実測: 3,000 行の全解析が
// 16ms、10,000 行で 42ms）。解析の結果は state に残るので、待つのは
// その文書で 1 回だけ。

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";

/// 木の解析を待つ上限。
export const PARSE_WAIT_MS = 1000;

/// `upto` まで解析した木。間に合わなければ、そこまでの木で答える
/// （黙って固まるよりは、欠けたまま動くほうがまし）。
export function treeOf(
  state: EditorState,
  upto: number = state.doc.length,
): Tree {
  return ensureSyntaxTree(state, upto, PARSE_WAIT_MS) ?? syntaxTree(state);
}
