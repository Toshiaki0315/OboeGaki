// 文字色の付け外し（ADR-0061 決定 3）。文書の書き換えは純関数で決め、
// EditorView への適用は Editor の applyColor が担う。

import {
  COLOR_SPAN_CLOSE,
  colorSpanOpen,
  parseColorSpan,
  spanStyleOf,
} from "../lib/text-color";

export type Edit = { from: number; to: number; insert: string };

/// カーソル（または選択）を包んでいる**色だけの** span。無ければ null
function enclosingColorSpan(
  doc: string,
  from: number,
  to: number,
): { open: [number, number]; close: [number, number] } | null {
  const openRe = /<span\s+style\s*=\s*"[^"]*"\s*>/gi;
  let found: RegExpExecArray | null;
  while ((found = openRe.exec(doc)) !== null) {
    const openFrom = found.index;
    const openTo = openFrom + found[0].length;
    if (openTo > from) break; // 選択より後ろの開き
    const style = spanStyleOf(found[0]);
    if (style === null || parseColorSpan(style) === null) continue;
    // 色以外の属性は触らない（parseColorSpan が既に断っている）
    const closeFrom = doc.indexOf(COLOR_SPAN_CLOSE, openTo);
    if (closeFrom < 0) continue;
    // 中に別の開きがあれば入れ子。単純化して、いちばん内側だけを見る
    const nested = doc.slice(openTo, closeFrom).search(/<span\s/i);
    if (nested >= 0) continue;
    if (openTo <= from && to <= closeFrom) {
      return {
        open: [openFrom, openTo],
        close: [closeFrom, closeFrom + COLOR_SPAN_CLOSE.length],
      };
    }
  }
  return null;
}

/// 選択範囲を色の span で包む。中身をちょうど選んでいる span があれば色だけ
/// 差し替える。選択が無ければ null（何を包むか分からない）
export function colorEdit(
  doc: string,
  from: number,
  to: number,
  hex: string,
): Edit | null {
  if (from === to) return null;
  const around = enclosingColorSpan(doc, from, to);
  if (around && around.open[1] === from && around.close[0] === to) {
    return {
      from: around.open[0],
      to: around.close[1],
      insert: `${colorSpanOpen(hex)}${doc.slice(from, to)}${COLOR_SPAN_CLOSE}`,
    };
  }
  return {
    from,
    to,
    insert: `${colorSpanOpen(hex)}${doc.slice(from, to)}${COLOR_SPAN_CLOSE}`,
  };
}

/// 包んでいる色の span を外す（中身は残す）。無ければ null
export function clearColorEdit(
  doc: string,
  from: number,
  to: number,
): Edit | null {
  const around = enclosingColorSpan(doc, from, to);
  if (!around) return null;
  return {
    from: around.open[0],
    to: around.close[1],
    insert: doc.slice(around.open[1], around.close[0]),
  };
}

/// 行頭のブロックの印（見出し・箇条書き・番号・引用・チェック）。包みの外に置く
const BLOCK_MARK_RE = /^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+\. |> )+/;

/// 選択範囲に色を付ける編集の一式（実機 2026-09-11）。
///
/// - **行ごとに包む。** インラインの HTML は空行（段落）を越えられず、
///   箇条書きの項目も別のブロック。行の中の選ばれた部分だけを包む
/// - 行頭から選んでいれば、ブロックの印は包みの外に残す（`# ` を span の
///   中に入れると見出しでなくなる）
/// - 中身が空白だけの行は飛ばす。1 つも無ければ null
/// - 選択は**中の文字**に置き直す。続けて別の色を選べば差し替わる
///   （colorEdit の「中身をちょうど選んでいる」規則に乗る）
export function colorEdits(
  doc: string,
  from: number,
  to: number,
  hex: string,
): { changes: Edit[]; selection: { anchor: number; head: number } } | null {
  if (from >= to) return null;
  const changes: Edit[] = [];
  let lineStart = doc.lastIndexOf("\n", from - 1) + 1;
  while (lineStart < to) {
    const newline = doc.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? doc.length : newline;
    let segFrom = Math.max(from, lineStart);
    const segTo = Math.min(to, lineEnd);
    if (segFrom === lineStart) {
      const marker = BLOCK_MARK_RE.exec(doc.slice(lineStart, lineEnd));
      if (marker) segFrom = Math.min(segTo, lineStart + marker[0].length);
    }
    if (doc.slice(segFrom, segTo).trim()) {
      const edit = colorEdit(doc, segFrom, segTo, hex);
      if (edit) changes.push(edit);
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  if (changes.length === 0) return null;
  const open = colorSpanOpen(hex).length;
  const close = COLOR_SPAN_CLOSE.length;
  let offset = 0;
  let anchor = 0;
  let head = 0;
  changes.forEach((edit, index) => {
    const innerStart = edit.from + offset + open;
    const innerLength = edit.insert.length - open - close;
    if (index === 0) anchor = innerStart;
    head = innerStart + innerLength;
    offset += edit.insert.length - (edit.to - edit.from);
  });
  return { changes, selection: { anchor, head } };
}
