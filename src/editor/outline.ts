// 見出しの一覧（アウトライン、ADR-0022）。参照実装 core/outline.py の役目。
// Lezer の木から取るので、コードフェンス内の `#` を拾わない性質はただで付く。

import type { EditorState } from "@codemirror/state";
import { treeOf } from "./parse-tree";

export type OutlineItem = {
  level: number;
  text: string;
  from: number;
};

const HEADING_RE = /^ATXHeading(\d)$/;

export function outlineOf(state: EditorState): OutlineItem[] {
  const items: OutlineItem[] = [];
  // **木ができ切るまで待つ。** `syntaxTree` は時間で打ち切られるので、
  // 長いノートでは後ろの見出しが目次から落ちる（実測 2026-09-05）。
  // 待てなければ、届いているぶんだけ出す（次に呼ばれたときに増える）
  const tree = treeOf(state);
  tree.iterate({
    enter: (node) => {
      const heading = HEADING_RE.exec(node.name);
      if (!heading) {
        // 見出しはトップレベル（引用の中は対象外でよい）。中まで潜らない
        return node.node.parent === null || node.name === "Document"
          ? undefined
          : false;
      }
      const mark = node.node.getChild("HeaderMark");
      const from = mark ? mark.to : node.from;
      items.push({
        level: Number(heading[1]),
        text: state.sliceDoc(from, node.to).trim(),
        from: node.from,
      });
      return false;
    },
  });
  return items;
}
