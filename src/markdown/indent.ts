// 字下げの幅（21-4）。エディタの入力補助（リストの深さ）とライブプレビュー
// （箇条書きのぶら下げ）が同じ関数を別々に持っていた。タブは 4 字ぶん

/// 先頭の空白の幅（字数）。タブは 4 として数える。深さの比較と CSS の ch に使う
export function indentWidth(lead: string): number {
  let width = 0;
  for (const char of lead) width += char === "\t" ? 4 : 1;
  return width;
}
