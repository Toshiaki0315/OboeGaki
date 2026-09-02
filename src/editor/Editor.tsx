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
};

export function Editor({ initialDoc }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

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
