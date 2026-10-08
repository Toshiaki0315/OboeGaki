// 文字起こしと議事録の進み具合の窓（TASKS 28-4 / ADR-0070）。
// 外を押しても Esc でも閉じない（走っているものを見失わせない）。止めるはボタンだけ。

import type { TranscribeProgress } from "../hooks/useTranscribe";
import { Dialog } from "./Dialog";

export function TranscribeProgressDialog({
  progress,
  onStop,
}: {
  progress: TranscribeProgress;
  onStop: () => void;
}) {
  return (
    <Dialog title="文字起こし" className="unlock-palette" initialFocus="dialog">
      <div className="unlock-body">
        <p>{progress.label}</p>
        {progress.done === null ? (
          // 議事録の間はいつ終わるか分からない（割合を作らない）
          <progress />
        ) : (
          <>
            <progress value={progress.done} max={1} />
            <p className="pref-note">{`${Math.round(progress.done * 100)}%`}</p>
          </>
        )}
        <p className="pref-note">
          音声はこの Mac の中だけで文字にし、外へは出しません。
        </p>
      </div>
      <div className="pref-actions">
        <span className="pref-actions-right">
          <button onClick={onStop}>止める</button>
        </span>
      </div>
    </Dialog>
  );
}
