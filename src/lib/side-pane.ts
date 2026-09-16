/// 左下のペイン（フォルダ / タグ / やること）の開閉。
///
/// **排他で開く**（ユーザー要望 2026-09-04）。両方開くと一覧が痩せすぎる。
/// 開いた側が縦の約 1/3 を使う。前回どれを開いていたかを覚える鍵は、他の
/// 設定と同じ "oboegaki." 系でここに置く（App.tsx に字面を直書きしない。
/// レビュー 2026-09-16）。

export type SideKind = "folders" | "tags" | "tasks";

export const SIDE_PANE_KEY = "oboegaki.side";

const KINDS: readonly SideKind[] = ["folders", "tags", "tasks"];

/// 同じものを押したら閉じる、違うものなら入れ替わる
export function toggleSidePane(
  current: SideKind | null,
  target: SideKind,
): SideKind | null {
  return current === target ? null : target;
}

/// 起動時の状態。閉じていたこと（空文字）も覚える。記憶が無い・知らない字・
/// 読めないときはフォルダで始める
export function restoreSidePane(storage: {
  getItem: (key: string) => string | null;
}): SideKind | null {
  try {
    const kept = storage.getItem(SIDE_PANE_KEY);
    if (kept === "") return null;
    return (KINDS as readonly string[]).includes(kept ?? "")
      ? (kept as SideKind)
      : "folders";
  } catch {
    return "folders";
  }
}

/// 覚える。書けなくても開閉自体は生かす
export function rememberSidePane(
  storage: { setItem: (key: string, value: string) => void },
  kind: SideKind | null,
): void {
  try {
    storage.setItem(SIDE_PANE_KEY, kind ?? "");
  } catch {
    // 覚えられなくても開閉自体は生かす
  }
}
