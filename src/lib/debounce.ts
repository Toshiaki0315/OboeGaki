// 「最後の変更から一定時間経ったら実行する」（spec §7.4 の自動保存）。
// 参照実装 storage/autosave.py の Debouncer に相当する時間判断を
// フロント側で持つ（Rust 側は書き込みだけを担う）。
//
// action は非同期でよい。**flush は「発射」ではなく「完了」を待つ** —
// 発射だけ保証する形だと、保存（invoke）が終わる前に改名・ピン留め・
// 書き出しが走り、古い本文が勝つ事故になる（レビュー 2026-09-04）。
// タイマーで発射した実行が残っている間に次が発射されても直列にする
// （同じノートへの書き込みが追い越さない）。

export type Debouncer = {
  /// 実行を予約する。すでに予約があれば時計を巻き戻す
  schedule: (action: () => void | Promise<void>) => void;
  /// 予約があれば今すぐ実行し、**実行中のものも含めて**完了を待つ
  flush: () => Promise<void>;
  /// 予約を破棄する（実行中のものは止められない）
  cancel: () => void;
  readonly pending: boolean;
};

export function createDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: (() => void | Promise<void>) | null = null;
  // 実行中（またはその直列待ち）。null = 何も走っていない。
  // 失敗は action 側の持ち物なので、ここでは連なりを切らないよう
  // 握り潰す（呼び出し側の catch が扱う）
  let running: Promise<void> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queued = null;
  };

  const fire = (): Promise<void> => {
    const action = queued;
    cancel();
    if (action) {
      // 何も走っていなければ**その場で**実行する（タイマー発射の経路が
      // マイクロタスクへずれると「発射した」の観測が崩れる）。
      // 走っていれば後ろへ直列に繋ぐ（同じノートへの書き込みが追い越さない）
      let started: Promise<void>;
      if (running === null) {
        try {
          const result = action();
          started =
            result instanceof Promise
              ? result.catch(() => {})
              : Promise.resolve();
        } catch {
          started = Promise.resolve();
        }
      } else {
        started = running
          .then(() => action())
          .then(
            () => {},
            () => {},
          );
      }
      const settled: Promise<void> = started.then(
        () => {
          if (running === settled) running = null;
        },
        () => {
          if (running === settled) running = null;
        },
      );
      running = settled;
    }
    return running ?? Promise.resolve();
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
