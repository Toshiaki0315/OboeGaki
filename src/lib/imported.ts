// 取り込んだ文字を Markdown に整える（TASKS 4-6 / F-1）。
//
// PDF（F-2）と PowerPoint（F-3）の両方がここを通る。**ざっくり整えて手で
// 直す**前提で、元の見た目の再現は狙わない。
//
// 判断の物差しは「**間違えたときにどちらが困るか**」で揃える。消しすぎると
// 本文が減って気づけないので、迷ったら残す。見出しの推定も外れることが
// あるが、`##` が余分に付くのは目で見て直せる（参照実装 core/imported.py）。

/// 見出しらしさの上限。これより長い行は、句点が無くても本文として扱う。
const MAX_HEADING_LENGTH = 30;

/// 折り返しの続きと見なす行の長さ（そのページでいちばん長い行に対する割合）。
///
/// **PDF には空行が無い。** 段落の切れ目は「行が短いこと」でしか分からない
/// ので、ページの中で相対的に見る。これを入れないと 1 ページが 1 段落に潰れる。
const CONTINUATION_RATIO = 0.6;

/// 箇条書きに見える行頭記号。PDF も PowerPoint もこの手の記号で出てくる。
const BULLET_RE = /^\s*[・•‣▪▫◦·※●○◆◇■□▶▸\-–—*]\s*(?<body>.*)$/;

/// 文の終わりに見える記号。
export const SENTENCE_END = "。．.！？!?";

/// ページ番号らしい行。**行まるごとが番号のときだけ**落とす。
/// `2026`（年）や `12345` を消さないよう 3 桁までに絞る。
const PAGE_NUMBER_RE =
  /^\s*(?:[-–—]\s*\d{1,3}\s*[-–—]|\d{1,3}\s*\/\s*\d{1,3}|[Pp]\.?\s*\d{1,3}|\d{1,3}\s*(?:ページ|頁)|\d{1,3})\s*$/;

/// 落とす制御文字。PDF には改ページ（\f）や NUL が混ざる。
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const CJK_RE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/// 取り込んだ文字を揃える。
///
/// **NFKC は飾りではない。** 書き出した資料を読み戻すと `本⽇`
/// （KANGXI RADICAL SUN）が出てきて、**「本日」では検索に掛からない**。
/// 取り込んだ瞬間に揃えないと、あとから気づけない。
///
/// **全角の約物は変えない。** NFKC は `（）` を `()` にするが、取り込んだ
/// だけで句読点が変わるのは筋が悪い。退避してから正規化する。
export function normalizeText(text: string): string {
  const keep = "（）［］｛｝「」『』、。！？：；〜ー－―";
  const marks: string[] = [];
  const stashed = text
    .replace(CONTROL_RE, "\n")
    .replace(new RegExp(`[${keep}]`, "g"), (mark) => {
      marks.push(mark);
      return ` \u0001${marks.length - 1}\u0001 `;
    });
  return stashed
    .normalize("NFKC")
    .replace(/ \u0001(\d+)\u0001 /g, (_, index) => marks[Number(index)]);
}

/// その行がページ番号だけか。
///
/// **迷ったら残す。** 消しすぎると本文が減り、読み手は減ったことに
/// 気づけない（`2026` や `1. はじめに` は残す）。
export function isPageNumber(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\d{4}$/.test(trimmed)) return false; // 年
  return PAGE_NUMBER_RE.test(trimmed);
}

/// その行が見出しらしいか。短くて、文の終わりの記号が無く、箇条書きでもない。
/// **外れることがある**が、`##` が余分に付くのは目で見て直せる。
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return false;
  if (BULLET_RE.test(trimmed) || isPageNumber(trimmed)) return false;
  return !SENTENCE_END.includes(trimmed[trimmed.length - 1]);
}

/// ページごとの文字を 1 つの Markdown にする。
///
/// **ページの頭が見出しらしければ `##` にする。** 資料は 1 ページ = 1 枚の
/// スライドで、その先頭行が題であることが多い（PowerPoint の取り込みも
/// 同じ `##` 区切り）。
///
/// **中身が無ければ空**（題名だけのノートを作らせない）。
export function toMarkdown(pages: string[], title = ""): string {
  const parts: string[] = [];
  for (const page of pages) {
    parts.push(...pageBlocks(normalizeText(page)));
  }
  if (parts.length === 0) return "";
  const head = title.trim() ? [`# ${title.trim()}`] : [];
  return `${[...head, ...parts].join("\n\n")}\n`;
}

/// 1 ページぶんを、段落・箇条書き・見出しの並びにする。
///
/// **行が続いているかは「長さ」で見る。** PDF は幅で折り返すので、途中の
/// 行はページの端まで伸び、段落の最後の行だけが短くなる。
function pageBlocks(page: string): string[] {
  const lines = page.split("\n").map((line) => line.trim());
  const limit =
    Math.max(0, ...lines.map((line) => line.length)) * CONTINUATION_RATIO;
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let headingTaken = false;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(join(paragraph));
      paragraph = [];
    }
    if (bullets.length > 0) {
      blocks.push(bullets.join("\n"));
      bullets = [];
    }
  };

  for (const line of lines) {
    if (!line || isPageNumber(line)) {
      flush();
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      const body = (bullet.groups?.body ?? "").trim();
      if (body) bullets.push(`- ${body}`);
      continue;
    }
    if (bullets.length > 0) flush();
    if (
      !headingTaken &&
      blocks.length === 0 &&
      paragraph.length === 0 &&
      looksLikeHeading(line)
    ) {
      blocks.push(`## ${line}`);
      headingTaken = true;
      continue;
    }
    // 前の行が短い、または文として終わっていれば、そこで段落が切れている
    if (
      paragraph.length > 0 &&
      !continues(paragraph[paragraph.length - 1], limit)
    ) {
      flush();
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/// その行のあとに文章が続いているか。
///
/// ページの端まで伸びていて、文の終わりの記号で終わっていないなら、次の行は
/// 折り返しの続き。**短い行は段落の終わり**（あるいは箇条書きや小見出しの
/// ような独立した 1 行）と見なす。
function continues(line: string, limit: number): boolean {
  return line.length >= limit && !SENTENCE_END.includes(line[line.length - 1]);
}

/// 折り返された行を 1 つの段落に戻す。
///
/// **和文は詰めて繋ぐ。** PDF は行ごとに切れて出るので、空白を挟むと文の
/// 途中に隙間ができる。欧文は単語が続くので空白で繋ぐ。
function join(lines: string[]): string {
  let joined = lines[0];
  for (const line of lines.slice(1)) {
    const tail = joined.slice(-1);
    const separator = CJK_RE.test(tail) && CJK_RE.test(line[0]) ? "" : " ";
    joined += separator + line;
  }
  return joined;
}
