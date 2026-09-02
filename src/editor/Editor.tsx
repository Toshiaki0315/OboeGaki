// CM6 エディタの React ラッパ。
//
// CM6 は命令的 API なので React ツリーの外で生かす: ここでは mount/unmount
// だけを React に任せ、文書内容・選択などのエディタ状態は EditorView が持つ。
// 文書を React state や Zustand にミラーしてはならない（キーストロークごとの
// 再レンダリングは性能基準 16ms を壊す）。

import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { livePreview } from "./live-preview";

type Props = {
  initialDoc: string;
  /** 文書が変わるたびに呼ぶ。text の取り出しは呼び出し側の判断で行う
      （毎打鍵で全文を作らないため、関数を渡す） */
  onDocChanged?: (getText: () => string) => void;
};

export function Editor({ initialDoc, onDocChanged }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // onDocChanged の同一性で EditorView を作り直さないよう ref 経由で読む
  const notify = useRef(onDocChanged);
  notify.current = onDocChanged;

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
            if (update.docChanged) {
              notify.current?.(() => update.state.doc.toString());
            }
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
}
