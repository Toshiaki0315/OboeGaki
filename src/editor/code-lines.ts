// 行頭から始まる行がコードの中か（`:::` の囲みや `<details>` の見分け。22-1）。
// 画面の装飾（live-preview-zones）と書式コマンド（format-commands の寄せ。23-1）が
// 同じ判定を読む。

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/// コードフェンスの範囲（トップレベルのみ）。
export function fencedRanges(
  state: EditorState,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        out.push({ from: node.from, to: node.to });
        return false;
      }
      return node.node.parent === null || node.name === "Document"
        ? undefined
        : false;
    },
  });
  return out;
}

/// その行（0 始まり）がフェンスの中か。行頭の `:::` や `<details>` がコード例か
/// を見分ける（レビュー 2026-09-04）。**トップレベルのフェンスだけで足りる** —
/// 行頭から始まる行は、リストや引用の中のコードの行にはならない。
///
/// 以前はフェンスと**重なる**囲みを丸ごと外していて、コードブロックを含む
/// `:::note` が囲みにならなかった（HTML 書き出しは囲みにする。22-1）。今は
/// コードの行だけを開きにも閉じにも数えない
export function codeLineTest(state: EditorState): (index: number) => boolean {
  const ranges = fenceLineRanges(state);
  if (ranges.length === 0) return () => false;
  return (index) => {
    // 範囲は出てきた順（重ならない）。二分探索で index を含む範囲を探す
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const [first, last] = ranges[middle];
      if (index < first) high = middle - 1;
      else if (index > last) low = middle + 1;
      else return true;
    }
    return false;
  };
}

/// フェンスの行の範囲（0 始まりの行番号で、開きの行から閉じの行まで）。
/// 行と行の**あいだ**に字を差し込めるかを見るのに使う（23-1）
export function fenceLineRanges(state: EditorState): [number, number][] {
  return fencedRanges(state).map((fence) => [
    state.doc.lineAt(fence.from).number - 1,
    state.doc.lineAt(fence.to).number - 1,
  ]);
}
