// `:::note info` の囲み（B-3 / Qiita 記法）。参照実装 core/block_parser.py の
// `_classify_note_delimiter` と core/models.py の規則をそのまま移す。
//
// **新しい木のノードは作らない。** 行の並びとして見つけて、行の装飾
// （背景と左の線）と区切り行の隠しだけで表す。中身はふつうの Markdown の
// まま解析されるので、**強調も箇条書きも中で使える**。

import type { Text } from "@codemirror/state";

export const NOTE_KINDS = ["info", "warn", "alert"] as const;
/// 種類を省いた（`:::note` だけの）ときの扱い。省略は書き忘れではない。
export const DEFAULT_NOTE_KIND = "info";
/// 知らない綴り（`:::note warm` など）。
///
/// **`info` には寄せない。** 寄せると色が付くだけで、間違えたことに気づく
/// 手掛かりが無くなる（参照実装のユーザー報告）。囲みとしては成立させて
/// 本文は残しつつ、灰色にして**区切り行も隠さない**。
export const UNKNOWN_NOTE_KIND = "unknown";

export type NoteContainer = {
  /// 開きの `:::note …` 行の先頭。
  from: number;
  /// 閉じの `:::` 行の末尾。
  to: number;
  kind: string;
  /// 開きの行（隠す範囲）。
  open: { from: number; to: number };
  /// 閉じの行（隠す範囲）。
  close: { from: number; to: number };
};

// **行頭から始まるものだけ**を見る（字下げされた `:::` はコード例）
const OPEN_RE = /^:::note(?:[ \t]+(\S+))?[ \t]*$/;
const CLOSE_RE = /^:::[ \t]*$/;

/// 本文の中の囲みを、出てくる順に返す。
///
/// **閉じが無ければ囲みにしない**（書きかけの `:::` で以降の本文が全部
/// 囲みになると読めない。数式ブロックと同じ判断）。入れ子は見ない。
export function noteContainers(doc: Text): NoteContainer[] {
  const found: NoteContainer[] = [];
  let open: { from: number; to: number; kind: string } | null = null;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    // 開きも閉じも行頭が `:`。それ以外の行は正規表現に掛けず捨てる
    //（全行走査なので、この一枝で 10 倍近く変わる — 実測 2026-09-04）
    if (line.text.charCodeAt(0) !== 58) continue;
    if (open === null) {
      const started = OPEN_RE.exec(line.text);
      if (!started) continue;
      const kind = started[1] ?? DEFAULT_NOTE_KIND;
      open = {
        from: line.from,
        to: line.to,
        kind: (NOTE_KINDS as readonly string[]).includes(kind)
          ? kind
          : UNKNOWN_NOTE_KIND,
      };
      continue;
    }
    if (!CLOSE_RE.test(line.text)) continue;
    found.push({
      from: open.from,
      to: line.to,
      kind: open.kind,
      open: { from: open.from, to: open.to },
      close: { from: line.from, to: line.to },
    });
    open = null;
  }
  return found; // 閉じの無い開きは捨てる
}
