// 変換中の Enter を見分ける（T5）。
//
// 変換中の Enter は IME の確定であって、欄の「決定」ではない。ところが
// ブラウザによって届き方が違う:
// - 標準: keydown の `isComposing` が真
// - WebKit（WKWebView）: 変換中の打鍵は `keyCode` 229 で届く。さらに確定の
//   Enter は `compositionend` の**後**に `isComposing: false` で届くことが
//   ある（実機報告 2026-09-07: 題名の欄で確定と改名が同時に走った）
// 3 つを全部見る。最後のものは「確定の直後」を時間で見るしかない。

/// 確定から Enter までがこれより近ければ、同じ打鍵とみなす（ms）。
/// 人が続けて 2 回押す間隔（速くても 100ms 台）よりずっと短い。
const SAME_STROKE_MS = 50;

export type KeyLike = {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  timeStamp: number;
};

export function imeEnterGuard() {
  let endedAt = Number.NEGATIVE_INFINITY;
  return {
    /// `compositionend` を受けたら呼ぶ
    onCompositionEnd(event: { timeStamp: number }) {
      endedAt = event.timeStamp;
    },
    /// この keydown の Enter は IME のものか
    isImeEnter(event: KeyLike): boolean {
      if (event.key !== "Enter") return false;
      if (event.isComposing || event.keyCode === 229) return true;
      return event.timeStamp - endedAt < SAME_STROKE_MS;
    },
  };
}
