/// 右クリックのメニューを出す位置。
///
/// **メニューの大きさから決める。** 決め打ちの数字で上げ下げすると、項目の
/// 少ないメニューが押した場所から遠くに出る（ゴミ箱の 2 項目で気づいた）。

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/// 窓の外へはみ出さない位置に丸める。`margin` は窓の縁との隙間。
export function menuPosition(
  at: Point,
  size: Size,
  viewport: Size,
  margin = 8,
): Point {
  const fit = (value: number, length: number, limit: number) =>
    // 大きすぎて収まらないときは縁に貼り付ける（負の位置にしない）
    Math.max(margin, Math.min(value, limit - length - margin));
  return {
    x: fit(at.x, size.width, viewport.width),
    y: fit(at.y, size.height, viewport.height),
  };
}
