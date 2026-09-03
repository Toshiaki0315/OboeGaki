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
import { search, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { inputAssist } from "./input-assist";
import { formatKeymap } from "./format-commands";
import { editorModes, toggleFocus, toggleTypewriter } from "./modes";
import {
  activationClicks,
  activationHandler,
  type Activation,
} from "./activation";
import { attachmentEvents, type SaveAttachment } from "./attachments";
import { autoPair, urlPasteLink } from "./auto-pair";
import {
  imageResolver,
  livePreview,
  toggleSourceMode,
  type ImageResolver,
} from "./live-preview";
import { outlineOf, type OutlineItem } from "./outline";

// 外部変更のリロードによる書き換えの印。ユーザーの編集と区別して、
// onDocChanged（= 自動保存の予約）を発火させないために使う
const externalReload = Annotation.define<boolean>();

export type EditorHandle = {
  /// 文書全体を差し替える（外部変更のリロード用）。キャレットは同じ
  /// オフセットへ復元する（文書が縮んだら末尾に丸める）
  replaceText: (text: string) => void;
  /// 見出しの一覧（アウトライン用。呼んだときだけ数える = ADR-0022）
  getOutline: () => OutlineItem[];
  /// 今の本文（競合の「両方残す」で使う）
  getText: () => string;
  /// 指定位置へキャレットを置いてスクロールする（アウトラインのジャンプ）
  revealPos: (pos: number) => void;
  /// 表示モードの切り替え（メニューバーから呼ぶ）
  toggleSourceMode: () => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
};

type Props = {
  initialDoc: string;
  /** 文書が変わるたびに呼ぶ。text の取り出しは呼び出し側の判断で行う
      （毎打鍵で全文を作らないため、関数を渡す） */
  onDocChanged?: (getText: () => string) => void;
  /** 画像参照を表示可能な src へ解決する（vault のルートを知るのはアプリ側） */
  resolveImage?: ImageResolver;
  /** Cmd+クリック時の動作（ノートを開く・タグで絞る・URL を開く） */
  onActivate?: (action: Activation) => void;
  /** キャレット位置が変わるたびに呼ぶ（アウトラインの現在地表示用） */
  onCursorChanged?: (pos: number) => void;
  /** 貼り付け・ドロップの画像を保存して Markdown を返す（保存先は
      アプリ側の持ち物）。無ければ取り込みは無効 */
  saveAttachment?: SaveAttachment;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    initialDoc,
    onDocChanged,
    resolveImage,
    onActivate,
    onCursorChanged,
    saveAttachment,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // コールバックの同一性で EditorView を作り直さないよう ref 経由で読む
  const notify = useRef(onDocChanged);
  notify.current = onDocChanged;
  const activate = useRef(onActivate);
  activate.current = onActivate;
  const cursorChanged = useRef(onCursorChanged);
  cursorChanged.current = onCursorChanged;
  const attachmentSaver = useRef(saveAttachment);
  attachmentSaver.current = saveAttachment;

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
      getOutline() {
        return view.current ? outlineOf(view.current.state) : [];
      },
      getText() {
        return view.current?.state.doc.toString() ?? "";
      },
      toggleSourceMode() {
        if (view.current) toggleSourceMode(view.current);
      },
      toggleFocusMode() {
        if (view.current) toggleFocus(view.current);
      },
      toggleTypewriterMode() {
        if (view.current) toggleTypewriter(view.current);
      },
      revealPos(pos) {
        const current = view.current;
        if (!current) return;
        current.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
        });
        current.focus();
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
          autoPair, // 選択を * や [ で囲む（spec §5.5-4）
          inputAssist, // defaultKeymap より先（Enter/Tab の先勝ち）
          formatKeymap,
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
          // ノート内検索（Cmd+F）のパネルを日本語にする
          EditorState.phrases.of({
            Find: "検索",
            Replace: "置換",
            next: "次へ",
            previous: "前へ",
            all: "すべて",
            "match case": "大文字小文字を区別",
            "by word": "単語単位",
            regexp: "正規表現",
            replace: "置換",
            "replace all": "すべて置換",
            close: "閉じる",
          }),
          markdown({
            extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
          }),
          livePreview,
          editorModes,
          imageResolver.of(resolveImage ?? (async () => null)),
          activationClicks,
          activationHandler.of((action) => activate.current?.(action)),
          attachmentEvents((data, name) =>
            attachmentSaver.current
              ? attachmentSaver.current(data, name)
              : Promise.resolve(null),
          ),
          urlPasteLink, // 画像の取り込みが先、URL のリンク化が後
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
              cursorChanged.current?.(update.state.selection.main.head);
            }
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
