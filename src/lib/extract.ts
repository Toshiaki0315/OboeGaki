// 選択範囲を別のノートに切り出す（TASKS 4-9 / M-1 = 仮身化）。
//
// BTRON の「選択した部分が新しい実身として切り出され、元の場所には仮身が
// 残る」を Markdown に写したもの（参照実装 core/extract.py）。
// **ここはファイルを知らない**（作るのは呼び出し側）。
//
// **題名は本文から決まる。** ノートの題名は最初の H1（無ければ最初の
// 非空行）から読まれ、`[[…]]` はその題名で解決する。勝手に付けた題名は
// 本文から読めず、**リンクの先が行方不明**になったうえ、押すと「無ければ
// 作る」で 2 つ目ができる。気づきにくい。
//
// だから**題名を作り直したときは見出しを足して、本文から同じ題名が読める
// ようにする**。

/// 題名の長さ。**本文の 1 行がそのまま題名になる**（見出しが無いとき）ので、
/// 切らないと `[[…]]` が本文を埋め尽くす。
const MAX_TITLE_LENGTH = 40;
const UNTITLED = "無題";
/// `[[…]]` の中に入るとリンクがそこで切れて別のものを指す。
/// `|` は別名の記法に見える（note-link-complete.ts が同じ理由で除いている）。
const BREAKS_LINK = /[[\]|]/g;

export type Extracted = {
  /// 新しいノートの題名。`text` から読めることが保証される。
  title: string;
  /// 新しいノートの本文。
  text: string;
  /// 元の場所に残す文字列（`[[題名]]`）。
  link: string;
};

/// 選択範囲から切り出す材料を作る。中身が無ければ null。
///
/// `taken` は既にある題名。**同じ題名を 2 つ作らない** — `[[…]]` は題名で
/// 解決するので、重なるとどちらへ飛ぶか決まらない。
export function extractNote(
  selection: string,
  taken: string[] = [],
): Extracted | null {
  const body = selection.trim();
  if (!body) return null;

  const natural = titleOf(body);
  const title = avoid(fit(natural), taken);
  // **本文から同じ題名が読めるときだけ、本文を触らない**（触らずに済む
  // ほうが「書いた文がそのまま移った」と分かる = T1 の感覚）
  const text = titleOf(body) === title ? body : `# ${title}\n\n${body}`;
  return { title, text, link: `[[${title}]]` };
}

/// 本文から読める題名（最初の H1 → 最初の非空行）。
function titleOf(text: string): string {
  const lines = text.split("\n");
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,6}\s+/, "").trim();
  return lines.find((line) => line.trim())?.trim() ?? UNTITLED;
}

/// 題名として使える形にする。**落とした結果が空なら「無題」。**
function fit(title: string): string {
  const cleaned = title.replace(BREAKS_LINK, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return UNTITLED;
  return cleaned.slice(0, MAX_TITLE_LENGTH).trim() || UNTITLED;
}

/// 既にある題名を避ける。解決と同じく大文字小文字を区別しない。
function avoid(title: string, taken: string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(title.toLowerCase())) return title;
  let number = 2;
  while (used.has(`${title} ${number}`.toLowerCase())) number += 1;
  return `${title} ${number}`;
}
