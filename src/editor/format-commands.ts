// テキスト変換コマンド（spec §5.4）。参照実装 editor/commands.py の移植。
//
// Cmd+B などのトグルとリンク挿入。判断は純関数で、テキストと選択範囲から
// Replacement を返すだけ。トグルは「既に囲まれていれば外す」という分岐が
// 本体なので、GUI 越しではなくここで網羅的に検査する。

import type { StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/// `[start, end)` を `text` で置き換え、そのあと `[selectStart, selectEnd)` を選ぶ。
export type Replacement = {
  start: number;
  end: number;
  text: string;
  selectStart: number;
  selectEnd: number;
};

/// 選択範囲を `marker` で囲む。既に囲まれていれば外す。
/// 「外す」が無いと、間違えて押したときに戻す手段が Cmd+Z しかなくなる。
export function toggleWrap(
  text: string,
  start: number,
  end: number,
  marker: string,
): Replacement {
  const width = marker.length;

  if (start === end) {
    // 選択が無いときは記号だけ置いて、間にキャレットを入れる
    return {
      start,
      end: start,
      text: marker + marker,
      selectStart: start + width,
      selectEnd: start + width,
    };
  }

  const selected = text.slice(start, end);

  // マーカーが選択の外側にある（`**強調**` の `強調` だけを選んだ状態）
  if (
    text.slice(Math.max(0, start - width), start) === marker &&
    text.slice(end, end + width) === marker
  ) {
    return {
      start: start - width,
      end: end + width,
      text: selected,
      selectStart: start - width,
      selectEnd: end - width,
    };
  }

  // マーカーが選択の内側にある（`**強調**` ごと選んだ状態）
  if (
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(width, selected.length - width);
    return {
      start,
      end,
      text: inner,
      selectStart: start,
      selectEnd: start + inner.length,
    };
  }

  return {
    start,
    end,
    text: `${marker}${selected}${marker}`,
    selectStart: start + width,
    selectEnd: end + width,
  };
}

/// 選択文字を `[選択](url)` にする（spec §5.4 の Cmd+K）。
/// URL が空なら `()` の中にキャレットを置く。URL があればリンク全体の後ろへ。
export function insertLink(
  text: string,
  start: number,
  end: number,
  url = "",
): Replacement {
  const label = text.slice(start, end);
  const body = `[${label}](${url})`;
  const caret = start + (url ? body.length : label.length + 3);
  return { start, end, text: body, selectStart: caret, selectEnd: caret };
}

const HEADING_RE = /^(#{1,6})[ \t]+/;
const TASK_RE = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[( |[xX])\][ \t]+/;
const BULLET_RE = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)/;
const MAX_HEADING_LEVEL = 6;

/// 見出しレベルを増減する（spec §5.4 の Cmd+Ctrl+↑/↓）。
/// delta が正なら `#` が増えて見出しが深くなる。段落は delta > 0 で
/// 見出しになり、H1 でさらに上げると段落へ戻る。変化しないときは null。
export function shiftHeading(line: string, delta: number): string | null {
  const heading = HEADING_RE.exec(line);
  const current = heading ? heading[1].length : 0;
  const body = heading ? line.slice(heading[0].length) : line;

  const level = current + delta;
  if (level === current || level < 0 || level > MAX_HEADING_LEVEL) return null;
  if (level === 0) return body;
  return `${"#".repeat(level)} ${body}`;
}

/// 行の種類。呼び出し側が構文木から判定して渡す
export type LineContext = "list" | "heading" | "code" | "paragraph";

/// チェックボックスを切り替える（spec §5.4 の Cmd+Shift+T）。
/// タスクなら往復、リスト項目なら付与、ただの行はリスト化して付与。
/// 見出しとコードは変えない（事故防止）。
export function toggleCheckbox(
  line: string,
  context: LineContext,
): string | null {
  const task = TASK_RE.exec(line);
  if (task) {
    const state = task[2] === " " ? "x" : " ";
    return `${task[1]}[${state}] ${line.slice(task[0].length)}`;
  }
  const bullet = BULLET_RE.exec(line);
  if (bullet) {
    return `${bullet[1]}[ ] ${line.slice(bullet[0].length)}`;
  }
  if (context === "heading" || context === "code") return null;
  return `- [ ] ${line}`;
}

function wrapCommand(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const replacement = toggleWrap(
      state.doc.toString(),
      range.from,
      range.to,
      marker,
    );
    dispatch(
      state.update({
        changes: {
          from: replacement.start,
          to: replacement.end,
          insert: replacement.text,
        },
        selection: {
          anchor: replacement.selectStart,
          head: replacement.selectEnd,
        },
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

const linkCommand: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const replacement = insertLink(state.doc.toString(), range.from, range.to);
  dispatch(
    state.update({
      changes: {
        from: replacement.start,
        to: replacement.end,
        insert: replacement.text,
      },
      selection: { anchor: replacement.selectStart },
      userEvent: "input",
      scrollIntoView: true,
    }),
  );
  return true;
};

/// カーソル行の種類を構文木から判定する（toggleCheckbox の事故防止用）。
function lineContextAt(
  state: Parameters<StateCommand>[0]["state"],
  pos: number,
): LineContext {
  const tree = syntaxTree(state);
  for (
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
      pos,
      1,
    );
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return "code";
    if (/^ATXHeading|^SetextHeading/.test(node.name)) return "heading";
    if (node.name === "ListItem") return "list";
  }
  return "paragraph";
}

function lineCommand(
  transform: (line: string, context: LineContext) => string | null,
): StateCommand {
  return ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const next = transform(line.text, lineContextAt(state, line.from));
    if (next === null) return false;
    const column = state.selection.main.head - line.from;
    // 行頭のマーカー分の増減にキャレットを追従させる（行の範囲に丸める）
    const delta = next.length - line.text.length;
    const anchor =
      line.from + Math.max(0, Math.min(next.length, column + delta));
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: next },
        selection: { anchor },
        userEvent: "input",
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

/// spec §5.4 の書式ショートカット。
export const formatKeymap = keymap.of([
  { key: "Mod-b", run: wrapCommand("**") },
  { key: "Mod-i", run: wrapCommand("*") },
  { key: "Mod-Shift-x", run: wrapCommand("~~") },
  { key: "Mod-e", run: wrapCommand("`") },
  { key: "Mod-Shift-h", run: wrapCommand("::") },
  { key: "Mod-k", run: linkCommand },
  { key: "Mod-Ctrl-ArrowDown", run: lineCommand((l) => shiftHeading(l, 1)) },
  { key: "Mod-Ctrl-ArrowUp", run: lineCommand((l) => shiftHeading(l, -1)) },
  { key: "Mod-Shift-t", run: lineCommand(toggleCheckbox) },
]);
