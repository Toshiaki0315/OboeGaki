// CM6 エディタの React ラッパ。
//
// CM6 は命令的 API なので React ツリーの外で生かす: ここでは mount/unmount
// だけを React に任せ、文書内容・選択などのエディタ状態は EditorView が持つ。
// 文書を React state や Zustand にミラーしてはならない（キーストロークごとの
// 再レンダリングは性能基準 16ms を壊す）。

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { Annotation, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { inputAssist } from "./input-assist";
import {
  cycleHeading,
  formatKeymap,
  linesCommand,
  toggleBullet,
  toggleOrdered,
  toggleQuote,
} from "./format-commands";
import { editorModes, toggleFocus, toggleTypewriter } from "./modes";
import {
  activationClicks,
  activationHandler,
  type Activation,
} from "./activation";
import { attachmentEvents, type SaveAttachment } from "./attachments";
import { codeHighlight, resolveCodeLanguage } from "./code-blocks";
import { frontMatterHide, frontMatterRange } from "./frontmatter";
import { headingFolding } from "./folding";
import { insertTableAt, tableAutoFormat } from "./table-format";
import { plainCopyKeymap } from "./plain-copy";
import { autoPair, urlPasteLink } from "./auto-pair";
import { tagCompletion } from "./tag-complete";
import { noteLinkCompletion } from "./note-link-complete";
import {
  diagramThemeField,
  imageResolver,
  livePreview,
  setDiagramTheme,
  setSourceMode,
  sourceModeField,
  toggleSourceMode,
  type ImageResolver,
} from "./live-preview";
import type { MermaidTheme } from "./mermaid";
import { outlineOf, type OutlineItem } from "./outline";
import { statsOf, type TextStats } from "./stats";

// 外部変更のリロードによる書き換えの印。ユーザーの編集と区別して、
// onDocChanged（= 自動保存の予約）を発火させないために使う
const externalReload = Annotation.define<boolean>();

export type EditorHandle = {
  /// 文書全体を差し替える（外部変更のリロード用）。キャレットは同じ
  /// オフセットへ復元する（文書が縮んだら末尾に丸める）
  replaceText: (text: string) => void;
  /// 見出しの一覧（アウトライン用。呼んだときだけ数える = ADR-0022）
  getOutline: () => OutlineItem[];
  /// 文字数と行数（ステータスバー用。こちらも呼んだときだけ数える）
  getStats: () => TextStats;
  /// 今の本文（競合の「両方残す」で使う）
  getText: () => string;
  /// 選んでいる文字（無ければ空）。仮身化（M-1）で使う
  getSelection: () => string;
  /// 選んでいる範囲を差し替える（仮身化が `[[題名]]` を残す）
  replaceSelection: (text: string) => void;
  /// 指定位置へキャレットを置いてスクロールする（アウトラインのジャンプ）
  revealPos: (pos: number) => void;
  /// 図の見た目をテーマに合わせる（ADR-0021。変えると図を描き直す）
  setDiagramTheme: (theme: MermaidTheme) => void;
  /// 表示モードの切り替え（メニューバーと題名の行のボタンから呼ぶ）
  toggleSourceMode: () => void;
  /// 表示モードを指定して切り替える（切り替えボタン用）
  setSourceMode: (source: boolean) => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  /** キャレット位置に空の表を差し込む（rows は見出しを除いた行数） */
  insertTable: (rows: number, columns: number) => void;
  /** 行単位の書式（メニューの書式サブメニューから） */
  applyLineFormat: (kind: "heading" | "bullet" | "ordered" | "quote") => void;
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
  /** `#` 補完に出す既知のタグ（索引が持つ。呼ぶたびに取り直す） */
  knownTags?: () => string[];
  /** `[[` 補完に出すノートの題名（索引が持つ。呼ぶたびに取り直す） */
  knownNotes?: () => string[];
  /** 開いた直後のキャレット位置（雛形の `{{cursor}}`。UTF-16 単位）。
      省くと front matter の後ろ = 本文の先頭 */
  initialCursor?: number | null;
  /** 図の見た目（ADR-0021）。開いた時点のテーマ */
  diagramTheme?: MermaidTheme;
  /** 開いた時点の表示モード（ソースモードはノートを跨いで続く） */
  sourceMode?: boolean;
  /** 表示モードが変わったら呼ぶ（`Cmd+/` でも切り替わるため） */
  onSourceModeChanged?: (source: boolean) => void;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    initialDoc,
    onDocChanged,
    resolveImage,
    onActivate,
    onCursorChanged,
    saveAttachment,
    knownTags,
    knownNotes,
    initialCursor,
    diagramTheme,
    sourceMode,
    onSourceModeChanged,
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
  const tagSource = useRef(knownTags);
  tagSource.current = knownTags;
  const noteSource = useRef(knownNotes);
  noteSource.current = knownNotes;
  const modeChanged = useRef(onSourceModeChanged);
  modeChanged.current = onSourceModeChanged;

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
      getStats() {
        return view.current
          ? statsOf(view.current.state)
          : { characters: 0, lines: 0 };
      },
      getText() {
        return view.current?.state.doc.toString() ?? "";
      },
      getSelection() {
        const current = view.current;
        if (!current) return "";
        const { from, to } = current.state.selection.main;
        return current.state.sliceDoc(from, to);
      },
      replaceSelection(text) {
        const current = view.current;
        if (!current) return;
        const { from, to } = current.state.selection.main;
        if (from === to) return; // 選んでいなければ何もしない
        current.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input",
        });
        current.focus();
      },
      setDiagramTheme(theme) {
        const current = view.current;
        if (!current) return;
        if (current.state.field(diagramThemeField, false) === theme) return;
        current.dispatch({ effects: setDiagramTheme.of(theme) });
      },
      toggleSourceMode() {
        if (view.current) toggleSourceMode(view.current);
      },
      setSourceMode(source) {
        const current = view.current;
        if (!current) return;
        if (current.state.field(sourceModeField, false) === source) return;
        toggleSourceMode(current);
      },
      toggleFocusMode() {
        if (view.current) toggleFocus(view.current);
      },
      toggleTypewriterMode() {
        if (view.current) toggleTypewriter(view.current);
      },
      applyLineFormat(kind) {
        const current = view.current;
        if (!current) return;
        const command =
          kind === "heading"
            ? linesCommand((lines) => lines.map(cycleHeading))
            : kind === "bullet"
              ? linesCommand(toggleBullet)
              : kind === "ordered"
                ? linesCommand(toggleOrdered)
                : linesCommand(toggleQuote);
        command(current);
        current.focus();
      },
      insertTable(rows: number, columns: number) {
        const current = view.current;
        if (!current) return;
        const { from, to } = current.state.selection.main;
        const replacement = insertTableAt(
          current.state.doc.toString(),
          from,
          to,
          {
            rows,
            columns,
          },
        );
        current.dispatch({
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
        });
        current.focus();
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
        // 雛形の `{{cursor}}` があればそこへ。無ければ front matter の
        // 後ろ（隠れた領域の中で見えないまま打ち始めない）
        selection: {
          anchor:
            initialCursor != null
              ? Math.min(initialCursor, initialDoc.length)
              : (frontMatterRange(initialDoc)?.bodyStart ?? 0),
        },
        extensions: [
          frontMatterHide,
          diagramThemeField.init(() => diagramTheme ?? "light"),
          sourceModeField.init(() => sourceMode ?? false),
          history(),
          autoPair, // 選択を * や [ で囲む（spec §5.5-4）
          // タグ補完（C-4）。↑↓ / Enter は completionKeymap が持つ。
          // Tab は inputAssist（リストの字下げ）より**先**に置く —
          // 候補が出ていないときは false を返して字下げへ落ちる
          autocompletion({
            override: [
              tagCompletion(() => tagSource.current?.() ?? []),
              noteLinkCompletion(() => noteSource.current?.() ?? []),
            ],
            icons: false,
          }),
          keymap.of([{ key: "Tab", run: acceptCompletion }]),
          inputAssist, // defaultKeymap より先（Enter/Tab の先勝ち）
          formatKeymap,
          plainCopyKeymap, // Cmd+Shift+C（spec §5.4）
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
            // フェンス内は言語別に入れ子でパースする（TASKS 2-1）。
            // パーサ本体は最初にその言語が現れたときに遅延ロードされる
            codeLanguages: resolveCodeLanguage,
          }),
          syntaxHighlighting(codeHighlight),
          livePreview,
          tableAutoFormat, // 表を離れたら桁揃え（ADR-0003 決定 4）
          headingFolding, // 見出しの折りたたみ（ADR-0019）
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
            // `Cmd+/` でも切り替わるので、変わったことを外へ知らせる
            if (
              update.transactions.some((tr) =>
                tr.effects.some((effect) => effect.is(setSourceMode)),
              )
            ) {
              modeChanged.current?.(
                update.state.field(sourceModeField, false) ?? false,
              );
            }
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
