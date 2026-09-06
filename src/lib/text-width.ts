// 文字の幅を測る（TASKS 8-10。仕様 MEAS-01 の代わり）。
//
// **本物の幅テーブルは積めない。** 測る相手は「出力先の PowerPoint が使う
// 書体」で、こちらの機械に入っているかどうかは関係が無い（CFG-36）。
// 同梱するには書体そのものの計量値が要り、権利の話にもなる。
//
// そこで**字の種類ごとの近似**で測る。仕様 MEAS-10 は「一覧外の書体は
// 近似して安全のぶんを上げる」と言っているので、その扱いを全部に広げた
// 形になる。**近似であることは画面にも書く**（当たると言わない）。
//
// 近似の中身（1em = 字の大きさ）:
//
// | 種類                         | 幅    |
// | ---------------------------- | ----- |
// | 和文・全角・絵文字           | 1.00  |
// | 欧文の太い字（M W @ …）      | 0.85  |
// | 欧文の並（英数字の多く）     | 0.55  |
// | 欧文の細い字（i l 1 . , …）  | 0.28  |
// | 空白                         | 0.28  |

/// 安全のぶん（MEAS-10 の +12% を全部に掛ける）。**多めに見積もる** —
/// 溢れていないと言って溢れるほうが、逆より困る。
export const SAFETY = 1.12;

const WIDE = 1;
const BOLDISH = 0.85;
const NORMAL = 0.55;
const NARROW = 0.28;

const NARROW_CHARS = new Set([..."iIl1.,;:'`|!()[]{}/\\ "]);
const BOLDISH_CHARS = new Set([..."MWmw@%&#"]);

/// 1 文字の幅（em）。**コードポイントで見る**（絵文字を 2 つに割らない）。
function widthOf(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // ASCII より上は全角として扱う（和文・記号・絵文字）。**多めに倒す**
  if (code > 0x2e80 || code === 0x00a5) return WIDE;
  if (NARROW_CHARS.has(char)) return NARROW;
  if (BOLDISH_CHARS.has(char)) return BOLDISH;
  return NORMAL;
}

/// 文字列の幅（インチ）。`points` は字の大きさ（pt。1in = 72pt）。
export function measureIn(text: string, points: number): number {
  if (!text) return 0;
  let em = 0;
  for (const char of text) em += widthOf(char);
  return (em * points * SAFETY) / 72;
}

/// 和文はどこでも折れる（禁則は見ない）。欧文は空白で折る。
function isBreakable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code > 0x2e80;
}

/// 幅 `widthIn` に収めたときの行数。**枠の高さを決めるのに使う。**
///
/// 幅が 0 以下のときは 1 行として答える（呼び出し側に 0 除算を配らない）。
export function wrapCount(
  text: string,
  widthIn: number,
  points: number,
): number {
  if (widthIn <= 0) return 1;
  const perEm = (points * SAFETY) / 72;
  const budget = widthIn / perEm; // 1 行に入る em の数
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines += countLine(paragraph, budget);
  }
  return Math.max(1, lines);
}

/// 1 段落ぶんの行数。
function countLine(text: string, budget: number): number {
  if (!text) return 1;
  let lines = 1;
  let used = 0;
  let word = 0; // まだ行に確定していない欧文の語
  const flush = () => {
    if (used + word > budget && used > 0) {
      lines += 1;
      used = word;
    } else {
      used += word;
    }
    word = 0;
  };
  for (const char of text) {
    const width = widthOf(char);
    if (isBreakable(char)) {
      flush();
      if (used + width > budget && used > 0) {
        lines += 1;
        used = width;
      } else {
        used += width;
      }
      continue;
    }
    if (char === " ") {
      flush();
      used += width;
      continue;
    }
    word += width;
    // **長すぎる 1 語は諦めて切る**（無限に伸ばすと行数が 1 のままになる）
    if (word > budget) {
      lines += 1;
      used = 0;
      word = 0;
    }
  }
  flush();
  return lines;
}
