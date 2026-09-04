/// 設定に出すフォントの候補（要望 2026-09-04）。
///
/// **入っていないフォントは並べない。** 選べたのに何も変わらないのが
/// いちばん分かりにくい。実際、これまでの候補には解決されない名前が
/// 混じっていた（`Yu Gothic` は実際には `YuGothic`、`SF Pro` と
/// `SF Mono` は macOS がアプリに公開していない = ADR-0003 検証 2）。
///
/// 名前は CoreText の `CTFontManagerCopyAvailableFontFamilyNames` で
/// 確かめたもの（macOS 26 / 2026-09-04）。入っているかどうかは動かす側の
/// Mac で測る（同梱でないフォントは環境によって在ったり無かったりする）。

export type FontChoice = {
  /// CSS に書くファミリ名
  family: string;
  /// 候補に添える短い説明
  label: string;
};

/// 本文の候補。和文（ゴシック → 明朝 → その他）→ 欧文の順。
/// 見出しや装飾用の書体は入れない（長い文章を読む道具なので）。
export const BODY_FONTS: readonly FontChoice[] = [
  { family: "Hiragino Sans", label: "和文ゴシック（既定）" },
  { family: "Hiragino Maru Gothic ProN", label: "和文丸ゴシック" },
  { family: "BIZ UDGothic", label: "和文ゴシック・UD" },
  { family: "YuGothic", label: "和文ゴシック・游" },
  { family: "Tsukushi A Round Gothic", label: "和文丸ゴシック・筑紫 A" },
  { family: "Tsukushi B Round Gothic", label: "和文丸ゴシック・筑紫 B" },
  { family: "Toppan Bunkyu Gothic", label: "和文ゴシック・文久" },
  { family: "Hiragino Mincho ProN", label: "和文明朝" },
  { family: "BIZ UDMincho", label: "和文明朝・UD" },
  { family: "YuMincho", label: "和文明朝・游" },
  { family: "Toppan Bunkyu Mincho", label: "和文明朝・文久" },
  { family: "YuKyokasho", label: "和文教科書体" },
  { family: "Klee", label: "和文楷書体" },
  { family: "Osaka", label: "和文ゴシック・Osaka" },
  { family: "Helvetica Neue", label: "欧文サンセリフ" },
  { family: "Avenir Next", label: "欧文サンセリフ・幾何学的" },
  { family: "Optima", label: "欧文サンセリフ・筆脈あり" },
  { family: "Georgia", label: "欧文セリフ" },
  { family: "Palatino", label: "欧文セリフ・古典的" },
  { family: "Charter", label: "欧文セリフ・画面向き" },
  { family: "Times New Roman", label: "欧文セリフ・定番" },
  { family: "Verdana", label: "欧文サンセリフ・小さくても読める" },
];

/// 等幅（コード・数式・Mermaid のソース）の候補。
///
/// **日本語を混ぜると等幅は崩れる。** 一般的な等幅フォントは CJK を持たず、
/// 別のフォントに落ちて幅が 2:1 にならない（ADR-0003 の実測）。日本語ごと
/// 等幅にしたい人向けに、CJK を持つものを混ぜてある。
/// **`SF Mono` は入れない。** macOS はアプリに公開しておらず、名前で
/// 指定しても解決されない（ADR-0003 検証 2）。空欄のままなら CSS の
/// `ui-monospace` が同じものを出す。
export const MONO_FONTS: readonly FontChoice[] = [
  { family: "Menlo", label: "等幅（既定）" },
  { family: "Monaco", label: "等幅・古くからの定番" },
  { family: "Andale Mono", label: "等幅・字面が広い" },
  { family: "PT Mono", label: "等幅・細身" },
  { family: "Courier New", label: "等幅・タイプライタ" },
  { family: "Source Han Code JP", label: "等幅・日本語も組める" },
  { family: "BIZ UDGothic", label: "和文 UD・全角:半角 = 2:1" },
  { family: "Osaka-Mono", label: "等幅・Osaka" },
];

/// コード・数式・Mermaid のソースに使うフォントの候補。
///
/// **等幅だけに絞らない**（要望 2026-09-04）。桁を空白で揃えるのをやめた
/// （ADR-0044）ので、ここが等幅である必要はもう無い。読みやすさで選べる
/// ように、等幅を先に置いたうえで本文の候補も後ろに並べる。
export const CODE_FONTS: readonly FontChoice[] = [
  ...MONO_FONTS,
  ...BODY_FONTS.filter(
    (font) => !MONO_FONTS.some((mono) => mono.family === font.family),
  ),
];

/// 幅を測る係。渡された CSS の `font` 指定で見本の文字列を測って幅を返す。
export type Measure = (fontSpec: string) => number;

/// 測る見本。**和欧を混ぜる** — 和文専用でも欧文専用でも、どちらかの幅が
/// 変われば「入っている」と分かる。
export const FONT_SAMPLE = "あA漢Wiiii";

/// 大きめに測る（差が小数で潰れないように）。
const SAMPLE_FONT_SIZE = "40px";

/// 比べる相手。どれか 1 つと違えば、そのフォントで組めている。
const BASES = ["monospace", "serif", "sans-serif"] as const;

function quoted(family: string): string {
  return `"${family.replace(/"/g, "")}"`;
}

/// このフォントがこの Mac に入っているか。
export function isFontAvailable(family: string, measure: Measure): boolean {
  return BASES.some(
    (base) =>
      measure(`${SAMPLE_FONT_SIZE} ${quoted(family)}, ${base}`) !==
      measure(`${SAMPLE_FONT_SIZE} ${base}`),
  );
}

/// 候補のうち、この Mac に入っているものだけ。
/// `measure` が無い（測れない）ときは candidates をそのまま返す。
export function availableFonts(
  candidates: readonly FontChoice[],
  measure: Measure | null,
): FontChoice[] {
  if (!measure) return [...candidates];
  return candidates.filter((font) => isFontAvailable(font.family, measure));
}

/// 設定の値を CSS の font-family に直す。**逃げ道を必ず後ろに置く** —
/// 別の Mac で開いたときに、無いフォントで文字が消えないように。
export function fontStack(
  family: string,
  fallback = "-apple-system, sans-serif",
) {
  return family ? `${quoted(family)}, ${fallback}` : "";
}
