// 日付の文字（TASKS 7-5）。`<input type="date">` に渡す `YYYY-MM-DD`。
//
// **`toISOString()` を使わない。** あれは UTC なので、日本の 0 時 30 分が
// 前の日になる（その日のノートを開いたつもりで昨日が開く）。

/// この機械の時間帯での `YYYY-MM-DD`。
export function dayValue(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}
