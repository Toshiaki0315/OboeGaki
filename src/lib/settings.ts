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
/// 一覧とサイドバーの行間（参照実装 LineSpacing）。px では持たない —
/// 名前で選ばせて、実際の余白は対応表が決める。
export type LineSpacing = "tight" | "normal" | "relaxed";
/// 文字の読み取り（OCR）。今は macOS の Vision だけ（ADR-0041）。
export type OcrEngine = "mac";
/// 本文の横幅（ADR-0018）。**px では持たない** — 名前で選ばせて、実際の
/// 幅は対応表が決める。
export type ContentWidth = "standard" | "wide" | "full";

export type Settings = {
  theme: Theme;
  contentWidth: ContentWidth;
  /// 本文のフォント。空 = システムの既定のまま。
  bodyFont: string;
  /// コード・数式・Mermaid のソースのフォント。空 = 既定の等幅スタック。
  /// **等幅に限らない**（ADR-0044 で桁揃えをやめたので縛る理由が無い）。
  monoFont: string;
  /// タブを何文字ぶんの幅で見せるか。書いた文字は変わらない。
  tabWidth: number;
  /// 4 文字の字下げをコードブロックとして扱うか（ADR-0033）。既定は入り。
  indentedCode: boolean;
  /// 一覧とサイドバーの行間。本文には効かない。
  lineSpacing: LineSpacing;
  /// 文字の読み取りに使うもの。
  ocrEngine: OcrEngine;
  /// 版を残す間隔（分）。**本文の保存とは別**（本文は打ち終わって 0.8 秒）。
  /// 0 は「なし」= 自分で保存したときだけ残す。
  historyMinutes: number;
  /// ゴミ箱に置いておく日数（spec §7.6）。
  trashDays: number;
  /// ノート一覧のペイン幅（px）。ドラッグで変えられる（spec §5.1）。
  listWidth: number;
  /// アウトラインのペイン幅（px）。
  outlineWidth: number;
  /// ノート一覧を出すか（Cmd+2）。
  notesVisible: boolean;
  /// フォルダ・タグ・ゴミ箱の並び（サイドバー相当）を出すか（Cmd+1）。
  treesVisible: boolean;
  /// ローカルLLM のモデル名（ADR-0025。**空にはできない** — 空のまま
  /// 保存できると、押しても何も起きないアプリになる）。
  llmModel: string;
  /// Ollama のポート。**送り先は 127.0.0.1 に固定**で、これは同じ機械の
  /// 別の窓口を指すだけ。
  llmPort: number;
  /// 一度に渡す量（文脈長）。メモリと引き換え。
  llmContext: number;
  /// 答えを待つ上限（分）。手元のモデルで桁が違うので既定 1 つでは決められない。
  llmTimeoutMinutes: number;
  /// 答えたあとモデルを残す長さ（Ollama の既定と同じ 5 分）。
  llmKeepAlive: string;
};

export const THEMES: Theme[] = ["system", "light", "dark"];
export const LINE_SPACINGS: LineSpacing[] = ["tight", "normal", "relaxed"];
export const TAB_WIDTHS = [2, 4, 8];
export const CONTEXT_CHOICES = [4096, 8192, 16384, 32768];
export const CONTENT_WIDTHS: ContentWidth[] = ["standard", "wide", "full"];
export const HISTORY_CHOICES = [0, 15, 30, 60, 120];
export const MIN_TRASH_DAYS = 1;
export const MAX_TRASH_DAYS = 365;
export const MIN_PANE_WIDTH = 160;
export const MAX_PANE_WIDTH = 520;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  contentWidth: "standard",
  bodyFont: "",
  monoFont: "",
  tabWidth: 4,
  indentedCode: true,
  lineSpacing: "normal",
  ocrEngine: "mac",
  historyMinutes: 60, // Rust 側 history::DEFAULT_INTERVAL_MINUTES と同じ
  trashDays: 30, // spec §7.6
  listWidth: 240, // App.css の従来値
  outlineWidth: 220,
  // **開閉は明示的に持つ。** 参照実装は「見えているか」を DOM に尋ねて
  // いたため、`Cmd+H` で隠してから終了すると全ペインが「隠す」で保存され、
  // 次の起動が真っ白な窓になった（実測）
  notesVisible: true,
  treesVisible: true,
  llmModel: "gemma3:4b", // ADR-0025 の既定（1b は日本語が壊れる）
  llmPort: 11434,
  llmContext: 8192, // 既定の 4k では長いノートが黙って切れる
  llmTimeoutMinutes: 10,
  llmKeepAlive: "5m",
};

export const KEEP_ALIVE_CHOICES = ["0", "1m", "5m", "30m"];

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
    bodyFont: typeof stored.bodyFont === "string" ? stored.bodyFont : "",
    monoFont: typeof stored.monoFont === "string" ? stored.monoFont : "",
    tabWidth: pick(stored.tabWidth, TAB_WIDTHS, DEFAULT_SETTINGS.tabWidth),
    indentedCode: readFlag(stored.indentedCode, DEFAULT_SETTINGS.indentedCode),
    lineSpacing: pick(
      stored.lineSpacing,
      LINE_SPACINGS,
      DEFAULT_SETTINGS.lineSpacing,
    ),
    ocrEngine: "mac",
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
    listWidth: clampPaneWidth(stored.listWidth),
    outlineWidth: clampPaneWidth(
      stored.outlineWidth,
      DEFAULT_SETTINGS.outlineWidth,
    ),
    notesVisible: readFlag(stored.notesVisible, DEFAULT_SETTINGS.notesVisible),
    treesVisible: readFlag(stored.treesVisible, DEFAULT_SETTINGS.treesVisible),
    // 空のモデル名は既定へ戻す（押しても何も起きないアプリにしない）
    llmModel:
      typeof stored.llmModel === "string" && stored.llmModel.trim()
        ? stored.llmModel.trim()
        : DEFAULT_SETTINGS.llmModel,
    llmPort: readNumber(stored.llmPort, 1, 65535, DEFAULT_SETTINGS.llmPort),
    llmContext: readNumber(
      stored.llmContext,
      1024,
      131072,
      DEFAULT_SETTINGS.llmContext,
    ),
    llmTimeoutMinutes: readNumber(
      stored.llmTimeoutMinutes,
      1,
      60,
      DEFAULT_SETTINGS.llmTimeoutMinutes,
    ),
    llmKeepAlive: pick(
      stored.llmKeepAlive,
      KEEP_ALIVE_CHOICES,
      DEFAULT_SETTINGS.llmKeepAlive,
    ),
  };
}

export function saveSettings(storage: StorageLike, settings: Settings): void {
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...settings,
        trashDays: readDays(settings.trashDays),
        listWidth: clampPaneWidth(settings.listWidth),
        outlineWidth: clampPaneWidth(
          settings.outlineWidth,
          DEFAULT_SETTINGS.outlineWidth,
        ),
      }),
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
/// ペインの幅。**範囲の外は丸める** — 狭すぎ・広すぎは見た目の問題で、
/// 日数（readDays）と違って丸めても失うものが無い。
export function clampPaneWidth(
  value: unknown,
  fallback: number = DEFAULT_SETTINGS.listWidth,
): number {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return fallback;
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, width));
}

/// 真偽値だけを採る（`"はい"` のような手書きは既定へ）。
function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/// 範囲の外なら既定へ（丸めない。手で書き換えられた設定を信じない）。
function readNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const found = Math.round(Number(value));
  if (!Number.isFinite(found) || found < min || found > max) return fallback;
  return found;
}

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
