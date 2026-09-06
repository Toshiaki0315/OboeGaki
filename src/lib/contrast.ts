// 色の読みやすさ（TASKS 8-7 / CFG-19 / L-04）。
//
// **計算は 1 か所に置く**（VA-04）。設定画面用に別実装を作ると、値がずれた
// ときに原因が追えない。式は WCAG 2.1 の相対輝度とコントラスト比。
//
// **保存は妨げない**（VA-03）。読みにくい色を選ぶのも選択のうちで、
// こちらは実測値を添えて知らせるだけ。

/// `#` なし 6 桁（大文字小文字は問わない）。
function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/// 相対輝度（0 = 黒、1 = 白）。**緑を重く見る** — 人の目がそう感じる。
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// コントラスト比（1〜21）。順番は問わない。
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/// 本文は 4.5:1、大きな字は 3:1（CFG-19）。
export const BODY_RATIO = 4.5;
export const HEADING_RATIO = 3;

export type Verdict = {
  ratio: number;
  body: "ok" | "warn";
  heading: "ok" | "warn";
};

/// 読みやすさの判定。**実測値も返す**（画面に数字で出すため）。
export function contrastVerdict(front: string, back: string): Verdict {
  const ratio = contrastRatio(front, back);
  return {
    ratio,
    body: ratio >= BODY_RATIO ? "ok" : "warn",
    heading: ratio >= HEADING_RATIO ? "ok" : "warn",
  };
}
