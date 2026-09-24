// Enter / Tab の入力補助（spec §5.5）。参照実装 editor/input_handler.py の移植。
//
// 判断は StateCommand（EditorState だけで動く）に閉じ込め、ヘッドレスで
// テストする。入力補助は条件分岐が多く、GUI 越しでは組み合わせを網羅
// できないため（参照実装と同じ方針）。
//
// IME ガード（T5）: キーマップ側で view.composing 中は発火させない。
// 変換中の Enter は候補の確定、Tab は候補選択であって、リスト継続や
// インデントではない。ここは自動テストで再現できないので手動チェック
// （docs/manual_test.md）で担保する。

import type { EditorState, Line, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { insertTab } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";

export const INDENT = "  ";

import {
  BULLET_ITEM_RE as BULLET_RE,
  BULLET_TASK_RE as TASK_RE,
  ORDERED_PARTS_RE as ORDERED_RE,
} from "../markdown/syntax";
const QUOTE_RE = /^[ \t]*>[ \t]?/;
const LEADING_SPACE_RE = /^[ \t]+/;

type MarkerKind = "task" | "ordered" | "bullet" | "quote";
type Marker = { kind: MarkerKind; length: number };

/// 行頭の引用の頭（`> ` の繰り返し）。無ければ空
function quoteHead(line: string): string {
  let head = "";
  let rest = line;
  for (;;) {
    const found = QUOTE_RE.exec(rest);
    if (!found) return head;
    head += found[0];
    rest = rest.slice(found[0].length);
  }
}

/// 行頭のマーカーを判定する。順番が大事: タスクは箇条書きより先に見る。
/// 引用の中のリスト（`> - a`）はリストとして扱い、`length` は引用の頭込み
/// （以前は引用としてしか見えず、Enter で `- ` が落ちた。21-4）
function markerOf(line: string): Marker | null {
  const head = quoteHead(line);
  const rest = line.slice(head.length);
  const task = TASK_RE.exec(rest);
  if (task) return { kind: "task", length: head.length + task[0].length };
  const ordered = ORDERED_RE.exec(rest);
  if (ordered)
    return { kind: "ordered", length: head.length + ordered[0].length };
  const bullet = BULLET_RE.exec(rest);
  if (bullet) return { kind: "bullet", length: head.length + bullet[0].length };
  if (head) return { kind: "quote", length: head.length };
  return null;
}

/// この行を含むコードフェンス。無ければ null。
function fenceAround(state: EditorState, pos: number) {
  for (
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      state,
    ).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode") return node;
  }
  return null;
}

/// フェンスの中身の行か（フェンス行そのものは含まない）。
function isFenceBody(
  state: EditorState,
  fence: { from: number; to: number; getChildren: (n: string) => unknown[] },
  line: Line,
): boolean {
  const first = state.doc.lineAt(fence.from);
  if (line.number <= first.number) return false;
  // 閉じフェンスがある（CodeMark が 2 つ）なら最終行はフェンス行
  const closed = fence.getChildren("CodeMark").length >= 2;
  const last = state.doc.lineAt(fence.to);
  if (closed && line.number >= last.number) return false;
  return line.number <= last.number;
}

/// 継続時に次の行へ引き継ぐ接頭辞。引用の中のリストは引用の頭を付け戻す
function continuation(whole: string, marker: Marker): string {
  const head = marker.kind === "quote" ? "" : quoteHead(whole);
  const line = whole.slice(head.length);
  const bare: Marker = {
    kind: marker.kind,
    length: marker.length - head.length,
  };
  return head + continuationOf(line, bare);
}

function continuationOf(line: string, marker: Marker): string {
  switch (marker.kind) {
    case "task": {
      const task = TASK_RE.exec(line);
      // 済んだ項目の次に済んだ項目が来るのはおかしいので必ず未チェック
      return task ? `${task[1]}[ ]${task[2]}` : line.slice(0, marker.length);
    }
    case "ordered": {
      const ordered = ORDERED_RE.exec(line);
      if (!ordered) return line.slice(0, marker.length);
      // 以降の番号は振り直さない（§5.5-3）。ソースの diff を最小にするため
      const number = Number(ordered[2]) + 1;
      return `${ordered[1]}${number}${ordered[3]}${ordered[4]}`;
    }
    default:
      return line.slice(0, marker.length);
  }
}

/// 字下げ 1 段ぶん（タブ 1 つ、または空白 2 つ）を外した行。字下げが無ければ null。
/// タブで字下げしたリストでも解除と Shift+Tab が効くように（21-4）
function dropIndentUnit(line: string): string | null {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith(INDENT)) return line.slice(INDENT.length);
  return null;
}

/// 空の項目を 1 段浅くする（§5.5-2 の 2 段階解除）。
function outdent(line: string, marker: Marker): string {
  if (marker.kind === "quote") {
    const stripped = line.replace(QUOTE_RE, "");
    return stripped.trim() ? stripped : stripped.trimEnd();
  }
  // 引用の中のリスト: リストの印だけ外して引用の頭は残す
  const head = quoteHead(line);
  if (head) return head.trimEnd() ? head : head.trimEnd() + " ";
  return dropIndentUnit(line) ?? "";
}

/// Enter: リスト・引用のマーカー継続、空項目の段階的解除、コードの字下げ継承。
export const continueMarkup: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const column = range.head - line.from;

  const fence = fenceAround(state, line.from);
  if (fence) {
    // コードは字下げが意味を持つので前の行の字下げを引き継ぐ。
    // それ以外の補助（リスト等）はフェンス内では発火させない
    if (!isFenceBody(state, fence, line)) return false;
    const leading = LEADING_SPACE_RE.exec(line.text);
    if (!leading || column < leading[0].length) return false;
    const insert = `\n${leading[0]}`;
    dispatch(
      state.update({
        changes: { from: range.head, insert },
        selection: { anchor: range.head + insert.length },
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  }

  const marker = markerOf(line.text);
  if (!marker) return false;
  if (column < marker.length) {
    // マーカーの内側にキャレットがある。ここで継承すると壊れた行ができる
    return false;
  }

  if (!line.text.slice(marker.length).trim()) {
    // 空の項目: 改行せず 1 段浅くする
    const text = outdent(line.text, marker);
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: text },
        selection: { anchor: line.from + text.length },
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  }

  const insert = `\n${continuation(line.text, marker)}`;
  dispatch(
    state.update({
      changes: { from: range.head, insert },
      selection: { anchor: range.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/// 空白の幅（タブは 4 として数える。深さの比較にだけ使う）
function indentWidth(lead: string): number {
  let width = 0;
  for (const ch of lead) width += ch === "\t" ? 4 : 1;
  return width;
}

/// 番号付きの番号を振り直す（ADR-0066。要望 2026-09-17）。
/// `lines` は空行で切れるまでの 1 つのリスト（字下げを変えたあとの字面）。
/// 同じ深さの並びを 1 つの組として数え、入れ子は 1 から、親は続きから。
/// 先頭の組だけ元の番号から始める（`3.` で始めたリストを `1.` に戻さない）。
/// 点の箇条書きが同じ深さに挟まると、番号の組はそこで切れる（CommonMark でも
/// 別のリスト）。返すのは行番号（lines の添字）ごとの新しい行。変わらない行は同じ字
function renumberList(lines: readonly string[]): string[] {
  type Level = { width: number; next: number | null }; // null = 点の組
  const stack: Level[] = [];
  let first = true;
  return lines.map((line) => {
    const ordered = ORDERED_RE.exec(line);
    if (!ordered && !BULLET_RE.test(line)) return line;
    const lead = LEADING_SPACE_RE.exec(line)?.[0] ?? "";
    const width = indentWidth(lead);
    while (stack.length && stack[stack.length - 1].width > width) stack.pop();
    const top = stack[stack.length - 1];
    if (!ordered) {
      if (top && top.width === width) top.next = null;
      else stack.push({ width, next: null });
      return line;
    }
    const [head, indent, digits, delimiter, gap] = ordered;
    let number: number;
    if (top && top.width === width && top.next !== null) {
      number = top.next;
      top.next = number + 1;
    } else {
      number = first ? Number(digits) : 1;
      if (top && top.width === width) top.next = number + 1;
      else stack.push({ width, next: number + 1 });
    }
    first = false;
    if (String(number) === digits) return line;
    return `${indent}${number}${delimiter}${gap}${line.slice(head.length)}`;
  });
}

/// この行を含むリストの範囲（空行・リストでない行で切る）。行番号の [先頭, 末尾]
function listBlockAround(
  state: EditorState,
  lineNumber: number,
): [number, number] {
  const isItem = (n: number) => {
    const kind = markerOf(state.doc.line(n).text)?.kind;
    return kind !== undefined && kind !== "quote";
  };
  let start = lineNumber;
  while (start > 1 && isItem(start - 1)) start--;
  let end = lineNumber;
  while (end < state.doc.lines && isItem(end + 1)) end++;
  return [start, end];
}

function indentList(forward: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    if (fenceAround(state, line.from)) return false;
    const marker = markerOf(line.text);
    // 引用は対象外（リスト行だけ。それ以外は通常のタブ挿入に任せる）
    if (!marker || marker.kind === "quote") return false;
    if (!forward && dropIndentUnit(line.text) === null) return false;

    // 字下げを変えたあとの字面で、リスト全体の番号を振り直す（ADR-0066）。
    // 1 つの取り消しで戻るよう、字下げと番号の書き換えは同じ transaction に載せる
    const [start, end] = listBlockAround(state, line.number);
    const before: string[] = [];
    for (let n = start; n <= end; n++) before.push(state.doc.line(n).text);
    const at = line.number - start;
    before[at] = forward
      ? INDENT + before[at]
      : (dropIndentUnit(before[at]) ?? before[at]);
    const after = renumberList(before);

    const changes: { from: number; to: number; insert: string }[] = [];
    for (let n = start; n <= end; n++) {
      const current = state.doc.line(n);
      const next = after[n - start];
      if (n === line.number || next !== current.text) {
        // 行頭（字下げ + 番号）だけを書き換える。本文はカーソルごと動かさない
        const oldHead = ORDERED_RE.exec(current.text)?.[0].length ?? 0;
        const newHead = ORDERED_RE.exec(next)?.[0].length ?? 0;
        if (oldHead && newHead) {
          changes.push({
            from: current.from,
            to: current.from + oldHead,
            insert: next.slice(0, newHead),
          });
        } else if (n === line.number) {
          changes.push(
            forward
              ? { from: current.from, to: current.from, insert: INDENT }
              : {
                  from: current.from,
                  // 外した字下げ 1 段の長さ（タブなら 1、空白なら 2）
                  to: current.from + (current.text.length - next.length),
                  insert: "",
                },
          );
        }
      }
    }
    dispatch(
      state.update({
        changes,
        userEvent: forward ? "input.indent" : "delete.dedent",
      }),
    );
    return true;
  };
}

/// Tab: リスト項目を 1 段深くする。リスト行以外は通常のタブ挿入に任せる。
export const indentListMore: StateCommand = indentList(true);

/// Shift+Tab: リスト項目を 1 段浅くする。
export const indentListLess: StateCommand = indentList(false);

/// キーマップ。defaultKeymap より先に並べること（先勝ち）。
export const inputAssist = keymap.of([
  { key: "Enter", run: (view) => !view.composing && continueMarkup(view) },
  { key: "Tab", run: (view) => !view.composing && indentListMore(view) },
  { key: "Tab", run: insertTab },
  { key: "Shift-Tab", run: (view) => !view.composing && indentListLess(view) },
]);
