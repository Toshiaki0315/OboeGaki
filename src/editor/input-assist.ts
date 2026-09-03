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

const TASK_RE = /^([ \t]*[-*+][ \t]+)\[[ xX]\]([ \t]+)/;
const ORDERED_RE = /^([ \t]*)(\d{1,9})([.)])([ \t]+)/;
const BULLET_RE = /^[ \t]*[-*+][ \t]+/;
const QUOTE_RE = /^[ \t]*>[ \t]?/;
const LEADING_SPACE_RE = /^[ \t]+/;

type MarkerKind = "task" | "ordered" | "bullet" | "quote";
type Marker = { kind: MarkerKind; length: number };

/// 行頭のマーカーを判定する。順番が大事: タスクは箇条書きより先に見る。
function markerOf(line: string): Marker | null {
  const task = TASK_RE.exec(line);
  if (task) return { kind: "task", length: task[0].length };
  const ordered = ORDERED_RE.exec(line);
  if (ordered) return { kind: "ordered", length: ordered[0].length };
  const bullet = BULLET_RE.exec(line);
  if (bullet) return { kind: "bullet", length: bullet[0].length };
  const quote = QUOTE_RE.exec(line);
  if (quote) return { kind: "quote", length: quote[0].length };
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

/// 継続時に次の行へ引き継ぐ接頭辞。
function continuation(line: string, marker: Marker): string {
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

/// 空の項目を 1 段浅くする（§5.5-2 の 2 段階解除）。
function outdent(line: string, marker: Marker): string {
  if (marker.kind === "quote") {
    const stripped = line.replace(QUOTE_RE, "");
    return stripped.trim() ? stripped : stripped.trimEnd();
  }
  return line.startsWith(INDENT) ? line.slice(INDENT.length) : "";
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

function indentList(forward: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    if (fenceAround(state, line.from)) return false;
    const marker = markerOf(line.text);
    // 引用は対象外（リスト行だけ。それ以外は通常のタブ挿入に任せる）
    if (!marker || marker.kind === "quote") return false;
    if (forward) {
      dispatch(
        state.update({
          changes: { from: line.from, insert: INDENT },
          userEvent: "input.indent",
        }),
      );
      return true;
    }
    if (!line.text.startsWith(INDENT)) return false;
    dispatch(
      state.update({
        changes: { from: line.from, to: line.from + INDENT.length, insert: "" },
        userEvent: "delete.dedent",
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
