// 日付の文字（TASKS 7-5）。`<input type="date">` に渡す `YYYY-MM-DD`。
//
// **`toISOString()` を使わない。** あれは UTC なので、日本の 0 時 30 分が
// 前の日になる（その日のノートを開いたつもりで昨日が開く）。

const pad = (value: number) => String(value).padStart(2, "0");

/// この機械の時間帯での `YYYY-MM-DD`。
export function dayValue(when: Date): string {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/// `YYYY-MM-DD HH:MM`（一覧の更新時刻。年から書くので並べ替えで崩れない）
export function stampValue(when: Date): string {
  return `${dayValue(when)} ${clockValue(when)}`;
}

/// `HH:MM`（ステータスバーの保存時刻。日付は出さない）
export function clockValue(when: Date): string {
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
