// PowerPoint の書き出し設定（TASKS 8-1。仕様 OboegakiPptxSettingsSpec v1.0）。
//
// **文書をまたいで一貫させたいものだけ**を置く（仕様 1.1）。どこで分けるか・
// どのレイアウトにするかは Markdown の構造から決める（`slides.ts` の仕事）。
//
// **設定全体を初期化しない**（ST-03）。欠けた項目は既定で補い、知らない項目は
// 残し、壊れた値だけを既定に戻す。設定は「触ったのに消えた」がいちばん怖い。
//
// 色は ADR-0046 の決定 3 で **テーマ参照と具体色の 2 つ**を持てる形にした。
// 触っていない色は PowerPoint 側のテーマに追従する（5-6 の性質を残す）。

/// 版（CFG-90）。上げるときは `migrate` に 1 段足す。
export const PPTX_SETTINGS_VERSION = 1;

/// テーマの色を指す（`accent1` など）。PowerPoint 側でテーマを替えると追従する。
export type ThemeRef = { ref: string };
/// 具体色。**`#` なし 6 桁の大文字**（CFG-17。pptxgenjs は `#` 付き・8 桁で壊れる）。
export type HexColor = { hex: string };
export type SlideColor = ThemeRef | HexColor;

export type PagePreset =
  "16:9" | "4:3" | "16:10" | "a4-landscape" | "a4-portrait" | "9:16" | "custom";

export type PptxSettings = {
  version: number;
  page: {
    preset: PagePreset;
    /// `custom` のときだけ効く。内部は常にインチ（CFG-03）。
    customWidthIn: number;
    customHeightIn: number;
    /// 見せ方だけの単位。
    unit: "in" | "cm";
  };
  theme: {
    presetId: string;
    palette: {
      primary: SlideColor;
      secondary: SlideColor;
      accent: SlideColor;
      background: SlideColor;
      surface: SlideColor;
      text: SlideColor;
      textMuted: SlideColor;
      onPrimary: SlideColor;
    };
    backgroundStyle: "light" | "dark" | "sandwich";
  };
  font: {
    jp: string;
    latin: string;
    mono: string;
    fallbackJp: string[];
    scale: "small" | "normal" | "large";
  };
  layout: {
    splitLevel: 1 | 2 | 3;
    density: "full" | "normal" | "sparse";
    maxBulletItems: number;
    continuationSuffix: string;
    marginScale: "compact" | "normal" | "wide";
  };
  decoration: { imageCaption: boolean; codeLanguageLabel: boolean };
  footer: { pageNumber: boolean; text: string; showDate: boolean };
  notes: { keepOriginalText: boolean; llmSummary: boolean };
  advanced: { lintLevel: "off" | "warn" | "strict"; reproducible: boolean };
};

/// テーマ参照を作る。
export function themeRef(ref: string): ThemeRef {
  return { ref };
}

export function isThemeRef(color: SlideColor): color is ThemeRef {
  return typeof (color as ThemeRef).ref === "string";
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/// 色の字を `#` なし 6 桁の大文字にする（CFG-17）。色でなければ null。
///
/// **8 桁は 6 桁に切る。** 透明度を渡すと pptxgenjs が壊れたファイルを作る。
export function hexColor(text: string): HexColor | null {
  const found = HEX.exec(text.trim());
  if (!found) return null;
  const body = found[1];
  const six =
    body.length === 3 ? [...body].map((c) => c + c).join("") : body.slice(0, 6);
  return { hex: six.toUpperCase() };
}

/// 用紙の実寸（インチ）。`custom` は設定の値を使う。
export const PAGE_SIZES: Record<
  Exclude<PagePreset, "custom">,
  { widthIn: number; heightIn: number }
> = {
  "16:9": { widthIn: 13.333, heightIn: 7.5 },
  "4:3": { widthIn: 10, heightIn: 7.5 },
  "16:10": { widthIn: 12, heightIn: 7.5 },
  "a4-landscape": { widthIn: 11.69, heightIn: 8.27 },
  "a4-portrait": { widthIn: 8.27, heightIn: 11.69 },
  "9:16": { widthIn: 7.5, heightIn: 13.333 },
};

/// 用紙の辺の下限・上限（CFG-04。PowerPoint の上限が 56in）。
export const MIN_PAGE_IN = 1;
export const MAX_PAGE_IN = 56;
/// 片辺が他辺の何倍までか（CFG-04）。
export const MAX_PAGE_RATIO = 4;

export const DEFAULT_PPTX_SETTINGS: PptxSettings = {
  version: PPTX_SETTINGS_VERSION,
  page: {
    preset: "16:9",
    customWidthIn: 13.333,
    customHeightIn: 7.5,
    unit: "in",
  },
  theme: {
    // **既定はテーマに従う**（ADR-0046 の決定 3）。触った色だけ具体色になる
    presetId: "theme",
    palette: {
      primary: themeRef("accent1"),
      secondary: themeRef("accent2"),
      accent: themeRef("accent1"),
      background: themeRef("bg1"),
      surface: themeRef("bg2"),
      text: themeRef("tx1"),
      textMuted: themeRef("tx2"),
      onPrimary: themeRef("bg1"),
    },
    backgroundStyle: "sandwich",
  },
  font: {
    jp: "",
    latin: "",
    mono: "",
    fallbackJp: ["Yu Gothic", "MS PGothic"],
    scale: "normal",
  },
  layout: {
    splitLevel: 2,
    density: "normal",
    maxBulletItems: 6,
    continuationSuffix: "（続き）",
    marginScale: "normal",
  },
  decoration: { imageCaption: false, codeLanguageLabel: true },
  footer: { pageNumber: true, text: "", showDate: false },
  notes: { keepOriginalText: true, llmSummary: false },
  advanced: { lintLevel: "warn", reproducible: false },
};

type Bag = Record<string, unknown>;

const bagOf = (value: unknown): Bag =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Bag)
    : {};

function pick<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const flag = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const text = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

const words = (value: unknown, fallback: string[]) =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : fallback;

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/// 色を読む。テーマ参照はそのまま、字は正規化、それ以外は既定へ。
function color(value: unknown, fallback: SlideColor): SlideColor {
  if (typeof value === "string") return hexColor(value) ?? fallback;
  const bag = bagOf(value);
  if (typeof bag.ref === "string") return themeRef(bag.ref);
  if (typeof bag.hex === "string") return hexColor(bag.hex) ?? fallback;
  return fallback;
}

/// 用紙の値を確かめる（CFG-04）。だめなら幅・高さとも既定に戻す。
function pageSize(
  width: number,
  height: number,
): { customWidthIn: number; customHeightIn: number } {
  const fits = (side: number) => side >= MIN_PAGE_IN && side <= MAX_PAGE_IN;
  const balanced =
    width <= height * MAX_PAGE_RATIO && height <= width * MAX_PAGE_RATIO;
  if (fits(width) && fits(height) && balanced) {
    return { customWidthIn: width, customHeightIn: height };
  }
  return {
    customWidthIn: DEFAULT_PPTX_SETTINGS.page.customWidthIn,
    customHeightIn: DEFAULT_PPTX_SETTINGS.page.customHeightIn,
  };
}

/// 保存してあったものを設定にする（ST-03）。
///
/// **知らない項目は残す。** 新しい版のおぼえがきで書いた設定を、古い版で開いた
/// だけで捨ててしまわないため（ST-03）。
export function readPptxSettings(stored: unknown): PptxSettings {
  const bag = bagOf(stored);
  // 知らない版は読まない（読めない形を混ぜるより既定のほうが安全 = ST-06）
  if (bag.version !== PPTX_SETTINGS_VERSION) return DEFAULT_PPTX_SETTINGS;
  const base = DEFAULT_PPTX_SETTINGS;
  const page = bagOf(bag.page);
  const theme = bagOf(bag.theme);
  const palette = bagOf(theme.palette);
  const font = bagOf(bag.font);
  const layout = bagOf(bag.layout);
  const decoration = bagOf(bag.decoration);
  const footer = bagOf(bag.footer);
  const notes = bagOf(bag.notes);
  const advanced = bagOf(bag.advanced);
  const paint = (key: keyof PptxSettings["theme"]["palette"]) =>
    color(palette[key], base.theme.palette[key]);
  return {
    version: PPTX_SETTINGS_VERSION,
    page: {
      ...page,
      preset: pick(
        page.preset,
        [
          "16:9",
          "4:3",
          "16:10",
          "a4-landscape",
          "a4-portrait",
          "9:16",
          "custom",
        ] as const,
        base.page.preset,
      ),
      ...pageSize(
        number(page.customWidthIn, base.page.customWidthIn),
        number(page.customHeightIn, base.page.customHeightIn),
      ),
      unit: pick(page.unit, ["in", "cm"] as const, base.page.unit),
    },
    theme: {
      ...theme,
      presetId: text(theme.presetId, base.theme.presetId),
      palette: {
        ...palette,
        primary: paint("primary"),
        secondary: paint("secondary"),
        accent: paint("accent"),
        background: paint("background"),
        surface: paint("surface"),
        text: paint("text"),
        textMuted: paint("textMuted"),
        onPrimary: paint("onPrimary"),
      },
      backgroundStyle: pick(
        theme.backgroundStyle,
        ["light", "dark", "sandwich"] as const,
        base.theme.backgroundStyle,
      ),
    },
    font: {
      ...font,
      jp: text(font.jp, base.font.jp),
      latin: text(font.latin, base.font.latin),
      mono: text(font.mono, base.font.mono),
      fallbackJp: words(font.fallbackJp, base.font.fallbackJp),
      scale: pick(
        font.scale,
        ["small", "normal", "large"] as const,
        base.font.scale,
      ),
    },
    layout: {
      ...layout,
      splitLevel: pick(layout.splitLevel, [1, 2, 3] as const, 2),
      density: pick(
        layout.density,
        ["full", "normal", "sparse"] as const,
        base.layout.density,
      ),
      maxBulletItems: bullets(layout.maxBulletItems),
      continuationSuffix: text(
        layout.continuationSuffix,
        base.layout.continuationSuffix,
      ),
      marginScale: pick(
        layout.marginScale,
        ["compact", "normal", "wide"] as const,
        base.layout.marginScale,
      ),
    },
    decoration: {
      ...decoration,
      imageCaption: flag(decoration.imageCaption, base.decoration.imageCaption),
      codeLanguageLabel: flag(
        decoration.codeLanguageLabel,
        base.decoration.codeLanguageLabel,
      ),
    },
    footer: {
      ...footer,
      pageNumber: flag(footer.pageNumber, base.footer.pageNumber),
      text: text(footer.text, base.footer.text),
      showDate: flag(footer.showDate, base.footer.showDate),
    },
    notes: {
      ...notes,
      keepOriginalText: flag(
        notes.keepOriginalText,
        base.notes.keepOriginalText,
      ),
      llmSummary: flag(notes.llmSummary, base.notes.llmSummary),
    },
    advanced: {
      ...advanced,
      lintLevel: pick(
        advanced.lintLevel,
        ["off", "warn", "strict"] as const,
        base.advanced.lintLevel,
      ),
      reproducible: flag(advanced.reproducible, base.advanced.reproducible),
    },
  };
}

/// 箇条書きの上限（CFG-42。3〜10）。外れたら既定。
function bullets(value: unknown): number {
  const found = number(value, DEFAULT_PPTX_SETTINGS.layout.maxBulletItems);
  const whole = Math.round(found);
  return whole >= 3 && whole <= 10
    ? whole
    : DEFAULT_PPTX_SETTINGS.layout.maxBulletItems;
}

// ------------------------------------------------------------ 置き場（ST-01）

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PPTX_SETTINGS_KEY = "oboegaki.pptx";

/// 保存してあるものを読む。**読めなければ既定で立ち上げる** —
/// 設定が壊れているだけで書き出しが使えなくなるほうが困る。
export function loadPptxSettings(storage: StorageLike): PptxSettings {
  let raw: string | null;
  try {
    raw = storage.getItem(PPTX_SETTINGS_KEY);
  } catch {
    return DEFAULT_PPTX_SETTINGS;
  }
  if (!raw) return DEFAULT_PPTX_SETTINGS;
  try {
    return readPptxSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_PPTX_SETTINGS;
  }
}

/// そのまま JSON で置く（ST-02。`version` を必ず含める）。
export function savePptxSettings(
  storage: StorageLike,
  settings: PptxSettings,
): void {
  try {
    storage.setItem(PPTX_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 置けなくても操作は続ける（次に開いたとき既定に戻るだけ）
  }
}

/// 既定に戻す（UI-04）。**記録ごと消す** — 残しておくと、既定が変わった
/// ときに古い値がよみがえる。
export function resetPptxSettings(storage: StorageLike): void {
  try {
    storage.removeItem(PPTX_SETTINGS_KEY);
  } catch {
    // 消せなくても既定として扱う
  }
}
