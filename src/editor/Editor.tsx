// CM6 エディタの React ラッパ。
//
// CM6 は命令的 API なので React ツリーの外で生かす: ここでは mount/unmount
// だけを React に任せ、文書内容・選択などのエディタ状態は EditorView が持つ。
// 文書を React state や Zustand にミラーしてはならない（キーストロークごとの
// 再レンダリングは性能基準 16ms を壊す）。

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MouseEvent,
} from "react";
import {
  EditorView,
  keymap,
  lineNumbers as lineNumbersGutter,
} from "@codemirror/view";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { inputAssist } from "./input-assist";
import {
  FORMAT_COMMANDS,
  type FormatKind,
  formatKeymap,
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
import { slashCompletion } from "./slash-menu";
import { fenceLanguageCompletion } from "./fence-language";
import {
  diagramThemeField,
  editorHighlights,
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
import { moveSection } from "./move-section";

/// ソースモードのときは装飾も色分けも入れない（「書いたとおり」を見る）。
function highlightsFor(sourceMode: boolean) {
  return sourceMode
    ? []
    : [...editorHighlights(false), syntaxHighlighting(codeHighlight)];
}
import { copyCode } from "./copy-code";
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
  /// 選んでいる範囲を差し替える。**選んでいなければキャレットの位置へ
  /// 差し込む**（貼り付けの 2 回目以降は選択が無い）
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
  /** 書式を当てる（メニュー・ツールバーの両方から呼ぶ。中身は 1 つ） */
  applyFormat: (kind: FormatKind) => void;
  /** 見出しの節を丸ごと上（-1）／下（+1）へ動かす（7-1）。動かせたら true */
  moveSection: (headingFrom: number, delta: -1 | 1) => boolean;
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
  /** 本文の右クリック。**アプリ側でメニューを出す**（OS の既定を出さない） */
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  /** 貼り付け・ドロップの画像を保存して Markdown を返す（保存先は
      アプリ側の持ち物）。無ければ取り込みは無効 */
  saveAttachment?: SaveAttachment;
  /** タブを何文字ぶんの幅で見せるか（環境設定） */
  tabWidth?: number;
  /** 行番号を出すか（環境設定。TASKS 7-4） */
  lineNumbers?: boolean;
  /** 4 文字の字下げをコードブロックとして扱うか（ADR-0033）。
      パーサ構成なので、変えるときは呼び出し側が作り直す（key に含める） */
  indentedCode?: boolean;
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
  /** 読むだけにする（横に開く参照ペイン = U-1）。**同じ描き方を使い回す**
      ためのもので、別のプレビューを用意しない */
  readOnly?: boolean;
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
    onContextMenu,
    saveAttachment,
    tabWidth,
    lineNumbers,
    indentedCode,
    knownTags,
    knownNotes,
    initialCursor,
    diagramTheme,
    sourceMode,
    onSourceModeChanged,
    readOnly,
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
  // タブ幅は Compartment で差し替える（設定を変えた瞬間に効かせる）
  const tabSize = useRef(new Compartment());
  // 見た目（装飾と色分け）。**ソースモードで丸ごと外す**ので、作り直さずに
  // 差し替えられる形で持つ（実機報告 2026-09-06）
  const highlights = useRef(new Compartment());
  // 行番号は設定で入り切りするので、作り直さずに差し替えられる形で持つ
  const gutters = useRef(new Compartment());
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
        // **選んでいなくても差し込む。** 貼り付けは 2 回目以降が選択なしで
        // 来る（実機報告 2026-09-04: 1 回目しか効かなかった）。選んだ範囲を
        // 使い切る仮身化は、呼ぶ前に選択を確かめている
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
      applyFormat(kind) {
        const current = view.current;
        if (!current) return;
        FORMAT_COMMANDS[kind](current);
        // 押したあとは本文へ戻す。ボタンからでも打ち続けられるように
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
      moveSection(headingFrom, delta) {
        const current = view.current;
        if (!current) return false;
        const move = moveSection(current.state, headingFrom, delta);
        if (!move) return false;
        // **1 回の取り消しで戻る**（節の移動は 1 つの変更）。動かした先へ
        // キャレットを置いて、どこへ行ったかを見せる
        current.dispatch({
          changes: move.changes,
          selection: { anchor: move.headingAt },
          effects: EditorView.scrollIntoView(move.headingAt, {
            y: "center",
          }),
        });
        current.focus();
        return true;
      },
    }),
    [],
  );

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    current.dispatch({
      effects: tabSize.current.reconfigure(
        EditorState.tabSize.of(tabWidth ?? 4),
      ),
    });
  }, [tabWidth]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    current.dispatch({
      effects: gutters.current.reconfigure(
        lineNumbers ? lineNumbersGutter() : [],
      ),
    });
  }, [lineNumbers]);

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
          // 読むだけのペイン（U-1）。**同じ拡張のまま編集だけ止める** —
          // 別の描き方を用意すると、帯や折りたたみが 2 系統になる
          ...(readOnly
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : []),
          tabSize.current.of(EditorState.tabSize.of(tabWidth ?? 4)),
          gutters.current.of(lineNumbers ? lineNumbersGutter() : []),
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
              slashCompletion(), // 行頭の `/`（TASKS 6-1）
              fenceLanguageCompletion(), // ``` の直後の言語（TASKS 6-3）
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
            extensions: [
              relaxedAsterisk,
              extendedInline,
              TaskList,
              Table,
              // 4 字下げのコードを切れるようにする（ADR-0033。既定は入り）
              ...(indentedCode === false ? [{ remove: ["IndentedCode"] }] : []),
            ],
            // フェンス内は言語別に入れ子でパースする（TASKS 2-1）。
            // パーサ本体は最初にその言語が現れたときに遅延ロードされる
            codeLanguages: resolveCodeLanguage,
          }),

          livePreview,
          highlights.current.of(highlightsFor(sourceMode ?? false)),
          copyCode, // コードブロックのコピー（要望 2026-09-06）
          tableAutoFormat, // 表を離れたら整える（ADR-0003 決定 4 / ADR-0044）
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
              const source =
                update.state.field(sourceModeField, false) ?? false;
              modeChanged.current?.(source);
              // **装飾を丸ごと外す / 戻す。** update の最中には流せないので、
              // 1 拍おいてから差し替える（CM6 の決まり）
              const current = update.view;
              queueMicrotask(() => {
                current.dispatch({
                  effects: highlights.current.reconfigure(
                    highlightsFor(source),
                  ),
                });
              });
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

  return (
    <div ref={host} className="editor-host" onContextMenu={onContextMenu} />
  );
});
