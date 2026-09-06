// ステータスバー。ウィンドウの全幅（参照実装と同じ）で、左端に設定の歯車 —
// hitofude の置き場所に合わせる。

import { sheets, type TextStats } from "../editor/stats";

/// 保存時刻（時:分）。日付は出さない — 開いている間に保存した時刻なので、
/// 日付まで出すと情報が増えるだけで読み取りが遅くなる。
function clockOf(at: number): string {
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

export type StatusBarProps = {
  status: string;
  /// 開いているノートの字数と行数。開いていなければ null
  stats: TextStats | null;
  savedAt: number | null;
  /// 歯車が押された。押した絵の位置（メニューをその真上に出す）
  onMenu: (anchor: { left: number; top: number }) => void;
};

export function StatusBar({ status, stats, savedAt, onMenu }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <button
        className="settings-button"
        title="メニュー"
        aria-label="メニュー"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onMenu({ left: box.left, top: box.top });
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M12.4 8h2M11.11 11.11l1.42 1.42M8 12.4v2M4.89 11.11l-1.42 1.42M3.6 8h-2M4.89 4.89 3.47 3.47M8 3.6v-2M11.11 4.89l1.42-1.42"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle
            cx="8"
            cy="8"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle
            cx="8"
            cy="8"
            r="1.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </button>
      <span className="status-message">{status}</span>
      <span className="status-stats">
        {stats !== null &&
          // 原稿用紙の枚数は 1 枚を超えてから足す（ポメラ調べ 7-3）
          `${stats.characters} 文字 / ${stats.lines} 行` +
            (sheets(stats.characters) === null
              ? ""
              : ` / ${sheets(stats.characters)} 枚`)}
        {savedAt !== null && ` ・ 保存 ${clockOf(savedAt)}`}
      </span>
    </footer>
  );
}
