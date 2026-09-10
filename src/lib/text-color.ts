// 本文の文字色（ADR-0061）。`<span style="…">` のうち受けるものの判定を
// ここに一本化し、エディタ・HTML 書き出し・PowerPoint が同じものを使う。
//
// 受けるのは color と background-color の 2 属性、値は CSS の色名か
// `#` 付き 3/6 桁の 16 進だけ。それ以外が 1 つでも混じれば null（色として
// 扱わず、素の文字のまま = 壊さない・通さない）。

export type ColorSpan = { color?: string; background?: string };

const VALUE_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/;

export function parseColorSpan(style: string): ColorSpan | null {
  const found: ColorSpan = {};
  let any = false;
  for (const raw of style.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const colon = part.indexOf(":");
    if (colon < 0) return null;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (!VALUE_RE.test(value)) return null;
    if (name === "color") found.color = value;
    else if (name === "background-color") found.background = value;
    else return null;
    any = true;
  }
  return any ? found : null;
}

/// 受けた色を**こちらで組み直した** style の値（書いた属性は素通りさせない）
export function styleAttribute(span: ColorSpan): string {
  const parts: string[] = [];
  if (span.color) parts.push(`color:${span.color}`);
  if (span.background) parts.push(`background-color:${span.background}`);
  return parts.join(";");
}

/// ツールバーが書く開きタグ。値は 16 進の小文字（色名は道具ごとに色が違う）
export function colorSpanOpen(hex: string): string {
  return `<span style="color: ${hex.toLowerCase()}">`;
}

export const COLOR_SPAN_CLOSE = "</span>";

/// `<span style="…">` の形か。style の中身を返す（受けるかは parseColorSpan）
const OPEN_RE = /^<span\s+style\s*=\s*"([^"]*)"\s*>$/i;
export function spanStyleOf(tag: string): string | null {
  const found = OPEN_RE.exec(tag.trim());
  return found ? found[1] : null;
}

export function isSpanClose(tag: string): boolean {
  return /^<\/span\s*>$/i.test(tag.trim());
}

/// ツールバーの 6 色。ライトでもダークでも読める中間の明度
export const COLOR_PALETTE: readonly { label: string; hex: string }[] = [
  { label: "赤", hex: "#e53935" },
  { label: "橙", hex: "#fb8c00" },
  { label: "黄", hex: "#c9a800" },
  { label: "緑", hex: "#43a047" },
  { label: "青", hex: "#1e88e5" },
  { label: "紫", hex: "#8e24aa" },
];

/// PowerPoint 用: 色を `RRGGBB`（大文字・# なし）に。色名は代表的なものだけ
/// 写し、知らない名前は undefined（色を付けずに置く）
const NAMED: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  orange: "FFA500",
  purple: "800080",
  gray: "808080",
  grey: "808080",
  pink: "FFC0CB",
  brown: "A52A2A",
  cyan: "00FFFF",
  magenta: "FF00FF",
  navy: "000080",
  teal: "008080",
  olive: "808000",
  maroon: "800000",
  lime: "00FF00",
  silver: "C0C0C0",
  gold: "FFD700",
  crimson: "DC143C",
  indigo: "4B0082",
  violet: "EE82EE",
  tomato: "FF6347",
  coral: "FF7F50",
  salmon: "FA8072",
  khaki: "F0E68C",
  turquoise: "40E0D0",
  skyblue: "87CEEB",
  royalblue: "4169E1",
  darkblue: "00008B",
  darkgreen: "006400",
  darkred: "8B0000",
};
export function hexForPptx(value: string): string | undefined {
  const lower = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(lower)) return lower.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(lower)) {
    return lower
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  }
  return NAMED[lower];
}
