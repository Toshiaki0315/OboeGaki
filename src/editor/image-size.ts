// 画像の大きさ指定（TASKS 6-8、要望 2026-09-06）。
//
// **`![説明|300](道)` と書く**（Obsidian と同じ）。写真を貼ると本文幅
// いっぱいに出て縮められない、という穴を埋める。
//
// **ほかのビューアで開いても画像が壊れないほうを採った。** `=300x200` を
// 道のうしろに置く書き方（markdown-it-imsize など）もあるが、知らない
// ビューアでは**道の一部として読まれて画像が出なくなる**。説明に混ぜる形なら、
// 知らないビューアでは説明の字が少し伸びるだけで済む。

/// 大きさとして受ける上限（px）。これを超える数は書き間違いとみなす。
const MAX_SIZE = 10000;

const SIZE_RE = /^(\d+)(?:x(\d+))?$/;

/// 説明から大きさを切り出す。指定が無ければ `alt` だけを返す。
///
/// **見るのは最後の縦棒だけ。** `A|B` のような説明を大きさと取り違えない
/// ように、うしろが数のときだけ大きさとして扱う。
export function splitImageAlt(raw: string): {
  alt: string;
  width?: number;
  height?: number;
} {
  const bar = raw.lastIndexOf("|");
  if (bar < 0) return { alt: raw };
  const found = SIZE_RE.exec(raw.slice(bar + 1));
  if (!found) return { alt: raw };
  const width = Number(found[1]);
  const height = found[2] === undefined ? undefined : Number(found[2]);
  // 0 は消えるのと同じ。桁あふれは書き間違い（素の大きさで出す）
  if (width <= 0 || width > MAX_SIZE) return { alt: raw };
  if (height !== undefined && (height <= 0 || height > MAX_SIZE)) {
    return { alt: raw };
  }
  const alt = raw.slice(0, bar);
  return height === undefined ? { alt, width } : { alt, width, height };
}

/// 掴んで変えるときの下限（px）。これより小さいと掴めなくなる
const MIN_SIZE = 32;

/// 引いた幅を書ける範囲の整数に収める
export function clampImageWidth(width: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(width)));
}

/// `![説明](道)` の行。字下げ・説明・道と題名の 3 つに分ける（説明は `](` の手前まで）
const IMAGE_LINE_RE = /^(\s*!\[)(.*?)(\]\(.*)$/s;

/// 掴んで変えた幅を本文へ書き戻す（6-8b）。**幅だけ**書く — 縦は形なりに
/// 縮むので持たない（縦横を書いてあっても幅だけに直す）。null なら大きさの
/// 指定を外す。画像の行でなければそのまま返す
export function withImageWidth(markup: string, width: number | null): string {
  const found = IMAGE_LINE_RE.exec(markup);
  if (!found) return markup;
  const { alt } = splitImageAlt(found[2]);
  const next = width === null ? alt : `${alt}|${width}`;
  return `${found[1]}${next}${found[3]}`;
}
