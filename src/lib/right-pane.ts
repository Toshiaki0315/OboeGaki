/// 右側のペイン（アウトライン / アシスタント）の開閉。
///
/// **状態は 1 つ。** 真偽値 2 つで持つと「両方 true」という、画面に
/// 置き場所の無い状態を作れてしまう（実機で発覚 2026-09-04: アシスタントの
/// 隣に入れないアウトラインが左下へ回り込んだ）。ここで表現できなくする。

export type RightPane = "none" | "outline" | "assistant";

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
