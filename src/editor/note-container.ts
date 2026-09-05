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

/// 囲みの頭に出す印（要望 2026-09-05。Qiita と同じ形）。
///
/// **丸の中に収まる 1 文字**にしてある。画面（CM6 のテーマ）と書き出しの
/// CSS がここから作るので、印を変えるときは 1 か所でよい。
export const NOTE_ICONS: Record<string, string> = {
  info: "✓",
  warn: "!",
  alert: "✕",
  [UNKNOWN_NOTE_KIND]: "?",
};

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
  // 順次イテレータで舐める。doc.line(n) のランダムアクセスは呼ぶたびに
  // 木を辿って行文字列を作るので、全行走査では 1 桁遅い（実測 2026-09-04:
  // 7,000 行で 2.9ms → 0.3ms 台）。行頭が `:` でない行は正規表現に掛けない
  let from = 0;
  for (const iter = doc.iterLines(); !iter.next().done;) {
    const text = iter.value;
    const to = from + text.length;
    if (text.charCodeAt(0) === 58) {
      if (open === null) {
        const started = OPEN_RE.exec(text);
        if (started) {
          const kind = started[1] ?? DEFAULT_NOTE_KIND;
          open = {
            from,
            to,
            kind: (NOTE_KINDS as readonly string[]).includes(kind)
              ? kind
              : UNKNOWN_NOTE_KIND,
          };
        }
      } else if (CLOSE_RE.test(text)) {
        found.push({
          from: open.from,
          to,
          kind: open.kind,
          open: { from: open.from, to: open.to },
          close: { from, to },
        });
        open = null;
      }
    }
    from = to + 1; // 改行ぶん
  }
  return found; // 閉じの無い開きは捨てる
}
