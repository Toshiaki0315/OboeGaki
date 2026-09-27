// `:::note info` の囲み（B-3 / Qiita 記法）。参照実装 core/block_parser.py の
// `_classify_note_delimiter` と core/models.py の規則をそのまま移す。
//
// **新しい木のノードは作らない。** 行の並びとして見つけて、行の装飾
// （背景と左の線）と区切り行の隠しだけで表す。中身はふつうの Markdown の
// まま解析されるので、**強調も箇条書きも中で使える**。

import type { Text } from "@codemirror/state";
import { colonContainers, type ColonContainer } from "../markdown/containers";

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

/// 本文の中の囲みを、出てくる順に返す。
///
/// 見つけ方は markdown/containers の `colonContainers` 1 本（22-1）。**閉じが
/// 無ければ囲みにしない**（書きかけの `:::` で以降の本文が全部囲みになると
/// 読めない）。入れ子は見ない — 他の `:::` の囲みが開いている間の `:::note` は
/// 囲みにしない（ADR-0069 の決定 3）。`colon` は呼び手が 1 回の走査で作って
/// 渡す（details・寄せと共有する。コードの行を飛ばすのも呼び手）
export function noteContainers(
  doc: Text,
  colon: readonly ColonContainer[] = colonContainers(doc.iterLines()),
): NoteContainer[] {
  const found: NoteContainer[] = [];
  for (const entry of colon) {
    if (entry.kind !== "note") continue;
    const open = doc.line(entry.open + 1);
    const close = doc.line(entry.close + 1);
    const kind = entry.info || DEFAULT_NOTE_KIND;
    found.push({
      from: open.from,
      to: close.to,
      kind: (NOTE_KINDS as readonly string[]).includes(kind)
        ? kind
        : UNKNOWN_NOTE_KIND,
      open: { from: open.from, to: open.to },
      close: { from: close.from, to: close.to },
    });
  }
  return found;
}
