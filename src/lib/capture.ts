// どこからでも書き取り（ADR-0057 / 12-6）。窓の見分けと、窓を出す道具。
// 主窓と書き取りの窓は同じ index.html を使い、URL の印で描くものを変える。

export const CAPTURE_LABEL = "capture";
export const CAPTURE_QUERY = "capture";

/// この WebView は書き取りの窓か（`index.html?capture=1`）
export function isCaptureWindow(search: string): boolean {
  return new URLSearchParams(search).get(CAPTURE_QUERY) === "1";
}

/// 書き取りの窓の URL（Vite の dev でも tauri:// でも相対で通る）
export function captureUrl(): string {
  return `index.html?${CAPTURE_QUERY}=1`;
}
