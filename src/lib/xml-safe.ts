// 書き出し（Word / PowerPoint）の中身は XML になる。XML 1.0 が許さない制御文字を
// 入口で落とす（24-4）。PowerPoint や Word から貼った文には U+000B（段落内の改行）や
// U+000C（ページ区切り）が残り、docx も pptxgenjs も落とさないので、出来上がった
// ファイルを Word / PowerPoint が「壊れている」と言った。
//
// U+000B と U+000C は字として意味がある（行を分けている）ので改行に、ほかの制御
// 文字と U+FFFE / U+FFFF は取り除く。タブ・改行・復帰はそのまま

// eslint-disable-next-line no-control-regex -- 制御文字を見分けるための正規表現（24-4）
const LINE_LIKE_RE = /[\u000b\u000c]/g;
// eslint-disable-next-line no-control-regex -- 制御文字を見分けるための正規表現（24-4）
const DISALLOWED_RE = /[\u0000-\u0008\u000e-\u001f\u007f￾￿]/g;

export function xmlSafeText(text: string): string {
  return text.replace(LINE_LIKE_RE, "\n").replace(DISALLOWED_RE, "");
}
