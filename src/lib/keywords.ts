/// 質問から探す語を取り出す（L-2）。参照実装 core/keywords.py の移植。
///
/// **質問は検索語ではない。** 全文検索は打った通りの並びを探すので、
/// 「予算について何が決まった？」ではどのノートにも当たらない（参照実装の
/// 実測で出典 0 件）。
///
/// **形態素解析は入れない。** 辞書ごと抱えることになる。代わりに、日本語の
/// **漢字とカタカナの連なりは意味を担い、ひらがなは助詞と語尾に偏る**という
/// 性質だけを使って素朴に切り出す。
///
/// **割り切り**: ひらがなだけの語（「めも」など）は拾えない。拾うと助詞で
/// 全ノートに当たる。困ったら言葉を変えて打ち直せる（検索欄と同じ）。

/// 問い合わせの回数がそのまま増えるので、上から数語で足りる。
const MAX_TERMS = 4;
/// 1 文字は絞れない（「何」「が」で全ノートに当たる）。
const MIN_LENGTH = 2;

// 送り仮名の 1 文字は挟んで繋ぐ（「買い物」「打ち合わせ」）。ただし
// **助詞は繋がない**（「会議の議事録」を 1 語にすると当たらなくなる）
const PARTICLES = "のとがはをにでもやかへ";
const KANJI = "[一-鿿々〇]";
const BRIDGE = `(?:(?![${PARTICLES}])[ぁ-ん]${KANJI}+)*`;

// 漢字・カタカナ・英数字の連なり。**ひらがなだけの語は拾わない**。
// 長音符と中黒はカタカナ語の一部なので繋げる
const RUN = new RegExp(
  `${KANJI}+${BRIDGE}` + // 漢字（送り仮名を 1 文字だけ挟める）
    "|[ァ-ヺー・]+" + // カタカナ
    "|[A-Za-z][A-Za-z0-9_-]*" + // 英字で始まる語
    "|[0-9]+", // 数字
  "gu",
);

const TRIM = /^[ー・_-]+|[ー・_-]+$/g;

/// 探すのに使える語。**出た順のまま、重複を畳んで、数を絞る。**
export function terms(question: string): string[] {
  const found: string[] = [];
  for (const match of question.matchAll(RUN)) {
    const word = match[0].replace(TRIM, "");
    if ([...word].length < MIN_LENGTH || found.includes(word)) continue;
    found.push(word);
    if (found.length >= MAX_TERMS) break;
  }
  return found;
}
