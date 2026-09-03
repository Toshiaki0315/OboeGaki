// 環境設定（TASKS 3-9、参照実装 ui/preferences.py + config.py の該当部）。
//
// 置き場は 1-1（前回の vault）・1-5（文字サイズ）と同じ localStorage。
// **文字サイズだけは別モジュール**（lib/font-size.ts）— Cmd+= / Cmd+- から
// も動かすので、設定ダイアログとは別の入口を持っている。
//
// **壊れた値でアプリを止めない。** localStorage は手で編集できるので、
// 読めない値は既定へ落とす。

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SETTINGS_KEY = "oboegaki.settings";

export type Theme = "system" | "light" | "dark";
/// 本文の横幅（ADR-0018）。**px では持たない** — 名前で選ばせて、実際の
/// 幅は対応表が決める。
export type ContentWidth = "standard" | "wide" | "full";

export type Settings = {
  theme: Theme;
  contentWidth: ContentWidth;
  /// 版を残す間隔（分）。**本文の保存とは別**（本文は打ち終わって 0.8 秒）。
  /// 0 は「なし」= 自分で保存したときだけ残す。
  historyMinutes: number;
  /// ゴミ箱に置いておく日数（spec §7.6）。
  trashDays: number;
};

export const THEMES: Theme[] = ["system", "light", "dark"];
export const CONTENT_WIDTHS: ContentWidth[] = ["standard", "wide", "full"];
export const HISTORY_CHOICES = [0, 15, 30, 60, 120];
export const MIN_TRASH_DAYS = 1;
export const MAX_TRASH_DAYS = 365;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  contentWidth: "standard",
  historyMinutes: 60, // Rust 側 history::DEFAULT_INTERVAL_MINUTES と同じ
  trashDays: 30, // spec §7.6
};

const WIDTHS: Record<ContentWidth, string> = {
  standard: "46rem", // App.css の従来値
  wide: "56rem",
  full: "none",
};

/// 本文の幅を CSS の `max-width` に渡せる形で返す。
export function contentWidthCss(width: ContentWidth): string {
  return WIDTHS[width] ?? WIDTHS.standard;
}

/// 実際に使う見た目。「システムに合わせる」だけが今の見た目を見る。
export function resolveTheme(
  theme: Theme,
  systemDark: boolean,
): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

export function loadSettings(storage: StorageLike): Settings {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!raw) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS; // 壊れた JSON。既定で開く
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const stored = parsed as Partial<Record<keyof Settings, unknown>>;
  return {
    theme: pick(stored.theme, THEMES, DEFAULT_SETTINGS.theme),
    contentWidth: pick(
      stored.contentWidth,
      CONTENT_WIDTHS,
      DEFAULT_SETTINGS.contentWidth,
    ),
    historyMinutes: pick(
      stored.historyMinutes,
      HISTORY_CHOICES,
      DEFAULT_SETTINGS.historyMinutes,
    ),
    trashDays: readDays(stored.trashDays),
  };
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...settings, trashDays: readDays(settings.trashDays) }),
    );
  } catch {
    // 記憶できなくても今の表示は生きている
  }
}

/// 選べる値のどれかなら採る。違えば既定（手で書き換えられた設定を信じない）。
function pick<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/// ゴミ箱の日数。**範囲の外は丸めずに既定へ落とす。**
///
/// 小さい側へ丸めると、壊れた値（`-3`）が「1 日で消す」という**取り返しの
/// つかない設定**に化ける。読めない値は「設定していない」と同じ扱いが安全。
function readDays(value: unknown): number {
  const days = Math.round(Number(value));
  if (
    !Number.isFinite(days) ||
    days < MIN_TRASH_DAYS ||
    days > MAX_TRASH_DAYS
  ) {
    return DEFAULT_SETTINGS.trashDays;
  }
  return days;
}
