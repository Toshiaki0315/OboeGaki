// 文字起こしと議事録を 1 枚のノートに組む（TASKS 28-3 / ADR-0070 の「形」）。純関数。
//
//   # 議事録 YYYY-MM-DD 元の名前
//   [元の録音（21 分）](attachments/…)       ← 添付に写したとき（決定 4）
//   ## 要旨 …                                 ← 議事録（無ければ、無いと書く）
//   :::details 文字起こし（…）                ← 全文は畳む（読むのは議事録）
//
// 話者は分からないので、全文の囲みにそう書いておく（ADR-0070「守れないもの」）。

/// 動画とみなす拡張子（それ以外は録音）
const VIDEO = /\.(mp4|mov|m4v)$/i;

export type MinutesNoteInput = {
  /// 取り込んだ日（YYYY-MM-DD）
  date: string;
  /// 元のファイルの名前（拡張子つき）
  sourceName: string;
  /// 録音の長さ（秒）
  duration: number;
  /// 添付に写した場所（保管フォルダからの相対）。写さなければ null
  attachment: string | null;
  /// 議事録（minutes_make の答え）。作れなければ null
  minutes: string | null;
  /// `[mm:ss] 文` の行
  lines: string;
};

/// 長さの読み方（「21 分」「1 時間 5 分」）
export function lengthLabel(seconds: number): string {
  if (seconds < 60) return "1 分未満";
  // 分は四捨五入（20 分 58 秒は「21 分」）
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  const rest = minutes % 60;
  return rest
    ? `${Math.floor(minutes / 60)} 時間 ${rest} 分`
    : `${minutes / 60} 時間`;
}

/// リンクの行き先。空白や括弧があれば `<…>` で包む（CommonMark で切れない）
function destination(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path;
}

export function minutesNote(input: MinutesNoteInput): {
  title: string;
  text: string;
} {
  const stem = input.sourceName.replace(/\.[^./]+$/, "");
  const title = `議事録 ${input.date} ${stem}`;
  const kind = VIDEO.test(input.sourceName) ? "元の動画" : "元の録音";
  const length = lengthLabel(input.duration);
  const source = input.attachment
    ? `[${kind}（${length}）](${destination(input.attachment)})`
    : `${kind}: ${input.sourceName}（${length}）`;
  const minutes =
    input.minutes?.trim() ||
    "議事録は作っていません（アシスタントが使えませんでした）。";
  const lines = input.lines.trim();
  const text = [
    `# ${title}`,
    "",
    source,
    "",
    minutes,
    "",
    ":::details 文字起こし（音声認識。話者は分かれていません）",
    lines,
    ":::",
    "",
  ].join("\n");
  return { title, text };
}
