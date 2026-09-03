// テキスト変換コマンド（spec §5.4）。参照実装 editor/commands.py の移植。
//
// Cmd+B などのトグルとリンク挿入。判断は純関数で、テキストと選択範囲から
// Replacement を返すだけ。トグルは「既に囲まれていれば外す」という分岐が
// 本体なので、GUI 越しではなくここで網羅的に検査する。

import type { StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";

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

/// spec §5.4 の書式ショートカット。
export const formatKeymap = keymap.of([
  { key: "Mod-b", run: wrapCommand("**") },
  { key: "Mod-i", run: wrapCommand("*") },
  { key: "Mod-Shift-x", run: wrapCommand("~~") },
  { key: "Mod-e", run: wrapCommand("`") },
  { key: "Mod-Shift-h", run: wrapCommand("::") },
  { key: "Mod-k", run: linkCommand },
]);
