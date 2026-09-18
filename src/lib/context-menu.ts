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

/// 画面の下端にあるボタンの**真上**にメニューを出す位置。
///
/// **高さを見積もらない。** 見積もった高さで上端を決めると、実際の
/// メニューがそれより短いときに、押したものとの間に隙間が空く
/// （実機報告 2026-09-04: 歯車から離れて出た）。下端を固定して、
/// 上へは中身なりに伸ばす。
export function anchorAbove(
  box: { left: number; top: number },
  width: number,
  viewport: Size,
  gap = 6,
  margin = 8,
): { left: number; bottom: number } {
  return {
    left: Math.max(margin, Math.min(box.left, viewport.width - width - margin)),
    bottom: viewport.height - box.top + gap,
  };
}

/// 右クリックの定型（19-3）: OS の既定のメニューを出さず（「Google で検索」
/// 「共有」など選んだ文字を外へ出す道が並ぶ。要望 2026-09-04）、押した場所と
/// 添えた値でこちらのメニューを開く。8 か所で同じ 4 行を書いていた
export function menuAt<T extends object>(
  open: (menu: T & Point) => void,
  data: T,
): (event: {
  preventDefault(): void;
  clientX: number;
  clientY: number;
}) => void {
  return (event) => {
    event.preventDefault();
    open({ ...data, x: event.clientX, y: event.clientY });
  };
}
