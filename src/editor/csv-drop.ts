// CSV を落として表にする（要望 2026-09-06）。
//
// **落とした場所に入れる。** 画像の取り込み（`attachments.ts`）と同じ作法で、
// 座標が本文の外なら今のカーソル位置へ。
//
// 判定と組み立ては純関数（`lib/csv.ts`）に置き、ここは薄い橋渡しに保つ。

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { csvToMarkdown, isCsvFile, parseCsv } from "../lib/csv";
import { decodeText } from "../lib/decode-text";
import { insertionTarget } from "./attachments";

/// 前後に空行を足す（段落の途中に表が食い込まないように）。
export function tableBlock(
  table: string,
  before: string,
  after: string,
): string {
  if (!table) return "";
  const head =
    before === "" || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const tail = after === "" || after.startsWith("\n") ? "" : "\n";
  return `${head}${table}${tail}`;
}

/// CSV を落としたら、その場に表を入れる拡張。
export function csvDropEvents(): Extension {
  return EditorView.domEventHandlers({
    drop: (event, view) => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(
        isCsvFile,
      );
      if (files.length === 0) return false;
      event.preventDefault();
      const startDoc = view.state.doc;
      const dropped =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      // **行の頭に入れる。** 表は行をまるごと使うものなので、落とした場所が
      // 文の途中でも語を割らない（落とした行の上に出る）
      const pos = view.state.doc.lineAt(dropped).from;
      void Promise.all(
        files.map(async (file) => {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            return csvToMarkdown(parseCsv(decodeText(bytes)));
          } catch {
            return ""; // 読めないものは黙って見送る（本文を壊さない）
          }
        }),
      ).then((tables) => {
        const table = tables.filter(Boolean).join("\n");
        if (!table) return;
        const target = insertionTarget(
          startDoc,
          { from: pos, to: pos },
          view.state,
        );
        const text = tableBlock(
          table,
          view.state.sliceDoc(Math.max(0, target.from - 2), target.from),
          view.state.sliceDoc(
            target.to,
            Math.min(view.state.doc.length, target.to + 1),
          ),
        );
        view.dispatch({
          changes: { from: target.from, to: target.to, insert: text },
          selection: { anchor: target.from + text.length },
          userEvent: "input.paste",
        });
      });
      return true;
    },
  });
}
