/// テンプレート `.pptx` の配色と書体を借りる（TASKS 5-6 / ADR-0045 案 A）。
///
/// **借りるのは配色（`clrScheme`）と書体（`fontScheme`）だけ。** 背景の
/// 飾りやロゴはマスタとレイアウトが持っていて、こちらのスライドは
/// プレースホルダを使っていないので効かない（ADR-0045 の実測）。
/// 図形の塗り方（`fmtScheme`）もこちらのまま — 借りると、こちらが置いた
/// 箱や罫線の見え方まで変わって、崩れ方が読めなくなる。
///
/// **テンプレートの中身は信じない。** 人が選ぶファイルなので、壊れていたり
/// PowerPoint 以外の zip だったりする。読めなければ既定のまま出す。

export type ThemeParts = {
  /// `<a:clrScheme>…</a:clrScheme>` の丸ごと
  colors: string;
  /// `<a:fontScheme>…</a:fontScheme>` の丸ごと
  fonts: string;
};

const COLORS = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/;
const FONTS = /<a:fontScheme[\s\S]*?<\/a:fontScheme>/;

/// テンプレートの `theme1.xml` から借りるところを取り出す。
/// **両方そろって初めて借りる** — 片方だけ入れ替えると、色と字が別の
/// テンプレート由来になって混ざる。
export function themeParts(themeXml: string): ThemeParts | null {
  const colors = COLORS.exec(themeXml)?.[0];
  const fonts = FONTS.exec(themeXml)?.[0];
  return colors && fonts ? { colors, fonts } : null;
}

/// こちらの `theme1.xml` の配色と書体を差し替える。
/// 差し替えられなければ元のまま返す（書き出しは止めない）。
export function applyThemeParts(themeXml: string, parts: ThemeParts): string {
  if (!COLORS.test(themeXml) || !FONTS.test(themeXml)) return themeXml;
  return themeXml.replace(COLORS, parts.colors).replace(FONTS, parts.fonts);
}
