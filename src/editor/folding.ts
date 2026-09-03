// 見出し単位の折りたたみ（TASKS 2-4、ADR-0019 の CM6 版)。
//
// 参照実装は QTextBlock.setVisible を自前で面倒見たが、CM6 は foldService に
// 「畳める範囲」を返すだけで、開閉 UI（ガター）・隠れた行の飛び越え・
// 置換ウィジェットまで標準機構が持つ。状態はセッション限り（ノートを
// 開き直せば全部開く — EditorView がノートごとに作り直されるため）。

import type { EditorState } from "@codemirror/state";
import { foldGutter, foldService, syntaxTree } from "@codemirror/language";

const HEADING_RE = /^ATXHeading(\d)$/;

/// 見出し行が畳む範囲（見出しの行末から、同じか浅い次の見出しの手前まで）。
/// 見出しでない・中身が無いときは null。
export function headingSection(
  state: EditorState,
  lineStart: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const tree = syntaxTree(state);
  let level = 0;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      const found = HEADING_RE.exec(node.name);
      if (found && node.from === line.from) level = Number(found[1]);
    },
  });
  if (level === 0) return null;

  // 次の「同じか浅い」見出しを探す。H1 は配下の H2 ごと巻き込む
  let end = state.doc.length;
  tree.iterate({
    from: line.to,
    to: state.doc.length,
    enter(node) {
      if (end < state.doc.length) return false; // もう決まった
      const found = HEADING_RE.exec(node.name);
      if (found && Number(found[1]) <= level && node.from > line.to) {
        end = state.doc.lineAt(node.from).from - 1; // 前の行の行末
        return false;
      }
    },
  });
  if (end <= line.to) return null; // 中身が無い
  return { from: line.to, to: end };
}

export const headingFolding = [
  foldService.of((state, lineStart) => headingSection(state, lineStart)),
  foldGutter({
    openText: "▾",
    closedText: "▸",
  }),
];
