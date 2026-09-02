// CM6 エディタの React ラッパ。
//
// CM6 は命令的 API なので React ツリーの外で生かす: ここでは mount/unmount
// だけを React に任せ、文書内容・選択などのエディタ状態は EditorView が持つ。
// 文書を React state や Zustand にミラーしてはならない（キーストロークごとの
// 再レンダリングは性能基準 16ms を壊す）。

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Annotation, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { livePreview } from "./live-preview";

// 外部変更のリロードによる書き換えの印。ユーザーの編集と区別して、
// onDocChanged（= 自動保存の予約）を発火させないために使う
const externalReload = Annotation.define<boolean>();

export type EditorHandle = {
  /// 文書全体を差し替える（外部変更のリロード用）。キャレットは同じ
  /// オフセットへ復元する（文書が縮んだら末尾に丸める）
  replaceText: (text: string) => void;
};

type Props = {
  initialDoc: string;
  /** 文書が変わるたびに呼ぶ。text の取り出しは呼び出し側の判断で行う
      （毎打鍵で全文を作らないため、関数を渡す） */
  onDocChanged?: (getText: () => string) => void;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { initialDoc, onDocChanged },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // onDocChanged の同一性で EditorView を作り直さないよう ref 経由で読む
  const notify = useRef(onDocChanged);
  notify.current = onDocChanged;

  useImperativeHandle(
    ref,
    () => ({
      replaceText(text) {
        const current = view.current;
        if (!current) return;
        if (current.state.doc.toString() === text) return;
        const head = Math.min(current.state.selection.main.head, text.length);
        current.dispatch({
          changes: { from: 0, to: current.state.doc.length, insert: text },
          selection: { anchor: head },
          annotations: externalReload.of(true),
        });
      },
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ extensions: [relaxedAsterisk] }),
          livePreview,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((t) => t.annotation(externalReload))) {
              return; // 外部リロードは「編集」ではない
            }
            notify.current?.(() => update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [initialDoc]);

  return <div ref={host} className="editor-host" />;
});
