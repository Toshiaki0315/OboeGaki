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
import {
  colonContainers,
  CONTAINER_CLOSE_RE,
  DETAILS_OPEN_RE,
  type ColonContainer,
} from "../markdown/containers";

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

// **行頭から始まるものだけ**を見る（字下げされたものはコード例）。`:::` の
// 綴りは markdown/containers が持つ（スライドと同じ規則。22-P）
const OPEN_RE = DETAILS_OPEN_RE;
const CLOSE_RE = CONTAINER_CLOSE_RE;
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
///
/// `:::details` の形は markdown/containers の `colonContainers` 1 本から取る
/// （22-1。`:::note` や寄せが開いている間の `:::details` は囲みにしない）。
/// 貼り付けた `<details>` の形は閉じが `</details>` で別なので、ここで別に
/// 走査する。`isCode` が真の行（フェンスの中）は開きにも閉じにも数えない
export function detailsContainers(
  doc: Text,
  colon: readonly ColonContainer[] = colonContainers(doc.iterLines()),
  isCode: (index: number) => boolean = () => false,
): DetailsContainer[] {
  const found: DetailsContainer[] = [];
  for (const entry of colon) {
    if (entry.kind !== "details") continue;
    const open = doc.line(entry.open + 1);
    const close = doc.line(entry.close + 1);
    found.push({
      from: open.from,
      to: close.to,
      summary: entry.info || DEFAULT_SUMMARY,
      form: "container",
      open: { from: open.from, to: open.to },
      close: { from: close.from, to: close.to },
    });
  }
  // 貼り付けた `<details>`。行頭が `<` でない行は正規表現に掛けない（全行走査は
  // 数え直しのたびに通る）
  let open: { from: number; to: number; summary: string } | null = null;
  let from = 0;
  let index = -1;
  for (const text of doc.iterLines()) {
    index += 1;
    const to = from + text.length;
    if (text.charCodeAt(0) === 60 && !isCode(index)) {
      if (open === null) {
        const opened = openedAt(text);
        if (opened?.form === "html")
          open = { from, to, summary: opened.summary };
      } else if (HTML_CLOSE_RE.test(text)) {
        found.push({
          from: open.from,
          to,
          summary: open.summary,
          form: "html",
          open: { from: open.from, to: open.to },
          close: { from, to },
        });
        open = null;
      }
    }
    from = to + 1; // 改行のぶん
  }
  return found.sort((a, b) => a.from - b.from);
}

/// 開きの行から畳む範囲（行末から、中身の最後の行末まで）。開きの行で
/// ないときと、中身が無いときは null。
///
/// **閉じの行は畳む範囲に入れない。** 閉じは装飾で隠しているので、畳んだ
/// ぶんと重なると差し替えが二重になる。
///
/// `isCode` はその位置がコードの中か（呼び手が木から答える）。コードの中の開きは
/// 畳まず、コードの中の閉じでは止まらない（22-1）
export function detailsSection(
  doc: Text,
  lineStart: number,
  isCode: (pos: number) => boolean = () => false,
): { from: number; to: number } | null {
  const line = doc.lineAt(lineStart);
  if (line.from !== lineStart) return null;
  const opened = openedAt(line.text);
  if (opened === null || isCode(line.from)) return null;
  // **文書の終わりまでは舐めない。** 閉じが見つかった時点で止まる
  for (let number = line.number + 1; number <= doc.lines; number += 1) {
    const next = doc.line(number);
    if (closesAt(next.text, opened.form) && !isCode(next.from)) {
      const end = doc.line(number - 1).to;
      return end > line.to ? { from: line.to, to: end } : null;
    }
  }
  return null;
}
