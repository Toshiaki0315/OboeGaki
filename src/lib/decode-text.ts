// 落としたファイルの文字を読む（要望 2026-09-06）。
//
// **まず UTF-8。読めなかったときだけ Shift_JIS で読み直す。** 当てずっぽうは
// 危ない（UTF-8 のまま Shift_JIS と決めつけると全部化ける）。Rust 側の
// `vault::decode_text` と同じ規則 — 片方だけ直すと食い違う。
//
// Excel が書く CSV は今も Shift_JIS のことが多いので、ここが要る。

export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("shift_jis").decode(bytes);
  }
  // BOM は字ではない（先頭に見えない文字が残ると検索も置換も外れる）
  return text.startsWith("﻿") ? text.slice(1) : text;
}
