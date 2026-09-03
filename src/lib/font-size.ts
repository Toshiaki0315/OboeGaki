// 本文の文字サイズ（TASKS 1-5、参照実装 G-5 / config.font_point_size）。
//
// 端では丸める — 上限まで一歩しか無くても、そこまでは動かす
// （押したのに何も起きないより、行けるところまで行くほうが素直）。

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DEFAULT_FONT_PX = 16; // App.css の従来値と同じ
export const MIN_FONT_PX = 10;
export const MAX_FONT_PX = 40;
export const FONT_STEP_PX = 1;

const KEY = "oboegaki.fontsize";

export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_PX;
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, px));
}

export function loadFontSize(storage: StorageLike): number {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return DEFAULT_FONT_PX;
    return clampFontSize(Number(raw));
  } catch {
    return DEFAULT_FONT_PX;
  }
}

export function saveFontSize(storage: StorageLike, px: number): void {
  try {
    storage.setItem(KEY, String(clampFontSize(px)));
  } catch {
    // 記憶できなくても今の表示は生きている
  }
}

/// Cmd と一緒に押されたキーを増減の指示へ写す。
///
/// メニューのアクセラレータは US 配列の物理キーで解釈されるため、JIS では
/// `Cmd+=` のつもりが `Cmd+;` に化けた（実機報告）。さらに Cmd を押して
/// いる間は Shift を足しても `event.key` が基底文字のまま届くので、
/// Shift の有無も見る — JIS の `Cmd+=` は物理的に `Cmd+Shift+-` で、
/// key は "-" のまま来る（実機報告 2 件目）。
export function zoomActionFor(
  key: string,
  shift: boolean,
): "in" | "out" | "reset" | null {
  switch (key) {
    case "=":
    case "+":
      return "in";
    case "-":
      return shift ? "in" : "out"; // JIS: Shift+- は「=」のつもり
    case ";":
      return shift ? "in" : null; // JIS: Shift+; は「+」のつもり
    case "0":
      return "reset";
    default:
      return null;
  }
}
