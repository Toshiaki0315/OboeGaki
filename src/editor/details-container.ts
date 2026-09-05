// 折りたたみ（TASKS 6-2、要望 2026-09-05）。
//
// **書くときは `:::details 呼び名` … `:::`**（`:::note` の仲間）。
// 生の HTML は書き出しで無効にしてある（`html: false`）ので、`<details>` を
// 書く道は開けない。ただし **Qiita から貼った `<details><summary>…` は
// 読むときだけ受ける** — 畳めないと、貼った本文が開いたまま読めなくなる。
//
// note-container と同じで、**新しい木のノードは作らない**。行の並びとして
// 見つけて、畳む範囲と行の装飾だけで表す。入れ子は見ない。

import type { Text } from "@codemirror/state";

/// 呼び名を書いていないときに見せる名前。
export const DEFAULT_SUMMARY = "詳細";

export type DetailsForm = "container" | "html";

export type DetailsContainer = {
  /// 開きの行の先頭。
  from: number;
  /// 閉じの行の末尾。
  to: number;
  /// 畳んだときに見せる呼び名。
  summary: string;
  form: DetailsForm;
  /// 開きの行。
  open: { from: number; to: number };
  /// 閉じの行。
  close: { from: number; to: number };
};

// **行頭から始まるものだけ**を見る（字下げされたものはコード例）
const OPEN_RE = /^:::details(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSE_RE = /^:::[ \t]*$/;
const HTML_OPEN_RE = /^<details>[ \t]*(?:<summary>(.*?)<\/summary>)?[ \t]*$/;
const HTML_CLOSE_RE = /^<\/details>[ \t]*$/;

type Opened = { summary: string; form: DetailsForm };

/// その行が開きなら、呼び名と形。開きでなければ null。
function openedAt(text: string): Opened | null {
  const first = text.charCodeAt(0);
  if (first === 58 /* : */) {
    const found = OPEN_RE.exec(text);
    if (found)
      return {
        summary: found[1]?.trim() || DEFAULT_SUMMARY,
        form: "container",
      };
    return null;
  }
  if (first === 60 /* < */) {
    const found = HTML_OPEN_RE.exec(text);
    if (found)
      return { summary: found[1]?.trim() || DEFAULT_SUMMARY, form: "html" };
  }
  return null;
}

/// その行が、その形の閉じか。
function closesAt(text: string, form: DetailsForm): boolean {
  return form === "container" ? CLOSE_RE.test(text) : HTML_CLOSE_RE.test(text);
}

/// 本文の中の折りたたみを、出てくる順に返す。
///
/// **閉じが無ければ囲みにしない**（書きかけの `:::details` で以降が全部
/// 畳めると読めない。note-container と同じ判断）。
export function detailsContainers(doc: Text): DetailsContainer[] {
  const found: DetailsContainer[] = [];
  let open: { from: number; to: number; opened: Opened } | null = null;
  // 行頭が `:` でも `<` でもない行は正規表現に掛けない（note-container と
  // 同じ理由 — 全行走査は打鍵のたびに通る）
  let from = 0;
  for (const iter = doc.iterLines(); !iter.next().done;) {
    const text = iter.value;
    const to = from + text.length;
    const first = text.charCodeAt(0);
    if (first === 58 || first === 60) {
      if (open === null) {
        const opened = openedAt(text);
        if (opened) open = { from, to, opened };
      } else if (closesAt(text, open.opened.form)) {
        found.push({
          from: open.from,
          to,
          summary: open.opened.summary,
          form: open.opened.form,
          open: { from: open.from, to: open.to },
          close: { from, to },
        });
        open = null;
      }
    }
    from = to + 1; // 改行のぶん
  }
  return found;
}

/// 開きの行から畳む範囲（行末から、中身の最後の行末まで）。開きの行で
/// ないときと、中身が無いときは null。
///
/// **閉じの行は畳む範囲に入れない。** 閉じは装飾で隠しているので、畳んだ
/// ぶんと重なると差し替えが二重になる。
export function detailsSection(
  doc: Text,
  lineStart: number,
): { from: number; to: number } | null {
  const line = doc.lineAt(lineStart);
  if (line.from !== lineStart) return null;
  const opened = openedAt(line.text);
  if (opened === null) return null;
  // **文書の終わりまでは舐めない。** 閉じが見つかった時点で止まる
  for (let number = line.number + 1; number <= doc.lines; number += 1) {
    const next = doc.line(number);
    if (closesAt(next.text, opened.form)) {
      const end = doc.line(number - 1).to;
      return end > line.to ? { from: line.to, to: end } : null;
    }
  }
  return null;
}
