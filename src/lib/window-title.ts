// タイトルバーに出す文字（要望 2026-09-10）。開いているノートの題名
// （ファイル名の幹 = ADR-0005）を先に、アプリ名を後ろに。macOS の慣例
// （「書類名 — アプリ名」）に合わせる。

import { APP_NAME } from "./app-name";
import { noteStem } from "./note-path";

export function windowTitle(path: string | null): string {
  if (!path) return APP_NAME;
  return `${noteStem(path)} — ${APP_NAME}`;
}
