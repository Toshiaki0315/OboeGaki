// 「最後の変更から一定時間経ったら実行する」（spec §7.4 の自動保存）。
// 参照実装 storage/autosave.py の Debouncer に相当する時間判断を
// フロント側で持つ（Rust 側は書き込みだけを担う）。

export type Debouncer = {
  /// 実行を予約する。すでに予約があれば時計を巻き戻す
  schedule: (action: () => void) => void;
  /// 予約があれば今すぐ実行する（ノート切替・終了時に呼ぶ）
  flush: () => void;
  /// 予約を破棄する
  cancel: () => void;
  readonly pending: boolean;
};

export function createDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: (() => void) | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queued = null;
  };

  const fire = () => {
    const action = queued;
    cancel();
    action?.();
  };

  return {
    schedule(action) {
      if (timer !== null) clearTimeout(timer);
      queued = action;
      timer = setTimeout(fire, delayMs);
    },
    flush: fire,
    cancel,
    get pending() {
      return queued !== null;
    },
  };
}
