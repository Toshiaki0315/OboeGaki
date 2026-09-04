/// 右側のペイン（アウトライン / アシスタント）の開閉。
///
/// **状態は 1 つ。** 真偽値 2 つで持つと「両方 true」という、画面に
/// 置き場所の無い状態を作れてしまう（実機で発覚 2026-09-04: アシスタントの
/// 隣に入れないアウトラインが左下へ回り込んだ）。ここで表現できなくする。

/// `reference` は「横に開く」で出すもう 1 枚（U-1）。**読むだけ。**
export type RightPane = "none" | "outline" | "assistant" | "reference";

/// 前回の開閉を覚えておく鍵。覚えるのはアウトラインだけ。
export const RIGHT_PANE_KEY = "oboegaki.outline";

export function togglePane(
  current: RightPane,
  target: Exclude<RightPane, "none">,
): RightPane {
  return current === target ? "none" : target;
}

/// 起動時の状態。読めなければ閉じた状態で始める（開閉を諦めるだけ）。
export function restoreRightPane(storage: {
  getItem: (key: string) => string | null;
}): RightPane {
  try {
    return storage.getItem(RIGHT_PANE_KEY) === "1" ? "outline" : "none";
  } catch {
    return "none";
  }
}

/// 横に出したノートがまだ在るか。**もう無いものを読ませ続けない** —
/// 直したつもりの内容を読み違える（参照実装 _forget_gone_reference）。
export function referenceLives(
  path: string | null,
  paths: readonly string[],
): boolean {
  return path !== null && paths.includes(path);
}
