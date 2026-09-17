// エディタの拡張一式（本番 = Editor.tsx とベンチ = editor-bench.ts の**同じ
// 出どころ**）。ベンチだけ別に組んでいて `editorHighlights` / `selectionDrawing`
// / `copyCode` / `tableKeys` などが抜け、性能値が実態を映していなかった
// （棚卸し 2026-09-17）。React と Tauri は知らない — 差し替えたいもの
// （補完の候補・画像と埋め込みの解決・押されたときの反応）は引数で受ける。
//
// Editor.tsx にだけあるもの: 読み取り専用・タブ幅と行番号の Compartment・
// 図のテーマとソース／プレビューの初期値・updateListener。

import { EditorView, keymap } from "@codemirror/view";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { inputAssist } from "./input-assist";
import { formatKeymap } from "./format-commands";
import { editorModes } from "./modes";
import {
  activationClicks,
  activationHandler,
  type Activation,
} from "./activation";
import { attachmentEvents, type SaveAttachment } from "./attachments";
import { csvDropEvents } from "./csv-drop";
import { selectionDrawing } from "./selection";
import { embedExtensions, embedResolver, type EmbedResolver } from "./embed";
import { codeHighlight, resolveCodeLanguage } from "./code-blocks";
import { frontMatterHide } from "./frontmatter";
import { headingFolding } from "./folding";
import { tableAutoFormat } from "./table-format";
import { tableKeys } from "./table-keys";
import { plainCopyKeymap } from "./plain-copy";
import { autoPair, urlPasteLink } from "./auto-pair";
import { tagCompletion } from "./tag-complete";
import { noteLinkCompletion } from "./note-link-complete";
import { slashCompletion } from "./slash-menu";
import { fenceLanguageCompletion } from "./fence-language";
import {
  editorHighlights,
  imageResolver,
  livePreview,
  type ImageResolver,
} from "./live-preview";
import { codeCopied, copyCode } from "./copy-code";

/// Markdown の解析の設定。本文と埋め込みの入れ子で同じものを使う（以前は
/// 2 か所に手で複写していた）。`indentedCode` を切ると 4 字下げをコードにしない（ADR-0033）
export function markdownConfig(indentedCode?: boolean): Extension {
  return markdown({
    extensions: [
      relaxedAsterisk,
      extendedInline,
      TaskList,
      Table,
      ...(indentedCode === false ? [{ remove: ["IndentedCode"] }] : []),
    ],
    // フェンス内は言語別に入れ子でパースする（TASKS 2-1）。パーサ本体は
    // 最初にその言語が現れたときに遅延ロードされる
    codeLanguages: resolveCodeLanguage,
  });
}

/// 見た目（太字・見出しの大きさ・リンクの色…）。**ソースモードでは外す**
export function highlightsFor(sourceMode: boolean): Extension {
  return sourceMode
    ? []
    : [...editorHighlights(false), syntaxHighlighting(codeHighlight)];
}

export type CoreOptions = {
  indentedCode?: boolean;
  /// `#` と `[[` の補完の候補（Zustand の一覧。props で渡すとタグが増える
  /// たびにエディタが作り直される）
  tagSource: () => readonly string[];
  noteSource: () => readonly string[];
  /// 見た目。Editor は Compartment に包んで渡す（ソースの切り替えで差し替える）
  highlights: Extension;
  focus: boolean;
  typewriter: boolean;
  resolveImage: ImageResolver;
  resolveEmbed: EmbedResolver;
  onActivate: (action: Activation) => void;
  onCodeCopied: (ok: boolean) => void;
  saveAttachment: SaveAttachment;
};

export function coreExtensions(options: CoreOptions): Extension[] {
  return [
    frontMatterHide,
    history(),
    autoPair, // 選択を * や [ で囲む（spec §5.5-4）
    // タグ補完（C-4）。↑↓ / Enter は completionKeymap が持つ。
    // Tab は inputAssist（リストの字下げ）より**先**に置く —
    // 候補が出ていないときは false を返して字下げへ落ちる
    autocompletion({
      override: [
        tagCompletion(() => [...options.tagSource()]),
        noteLinkCompletion(() => [...options.noteSource()]),
        slashCompletion(), // 行頭の `/`（TASKS 6-1）
        fenceLanguageCompletion(), // ``` の直後の言語（TASKS 6-3）
      ],
      icons: false,
    }),
    keymap.of([{ key: "Tab", run: acceptCompletion }]),
    tableKeys, // 表の中の Enter / Tab（行と列を足す。要望 2026-09-15）
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
    markdownConfig(options.indentedCode),
    csvDropEvents(), // CSV を落としたら表にする（要望 2026-09-06）
    livePreview,
    options.highlights,
    copyCode, // コードブロックのコピー（要望 2026-09-06）
    tableAutoFormat, // 表を離れたら整える（ADR-0003 決定 4 / ADR-0044）
    headingFolding, // 見出しの折りたたみ（ADR-0019）
    editorModes({ focus: options.focus, typewriter: options.typewriter }),
    imageResolver.of(options.resolveImage),
    // 埋め込み（ADR-0058）。入れ子のビューには同じ解析と見た目を渡し、
    // その中の埋め込みは解決しない（深さ 1）
    embedResolver.of(options.resolveEmbed),
    embedExtensions.of(() => [
      markdownConfig(options.indentedCode),
      livePreview,
      highlightsFor(false),
      imageResolver.of(options.resolveImage),
      embedResolver.of(NO_EMBED_RESOLVER),
      EditorView.lineWrapping,
    ]),
    activationClicks,
    activationHandler.of(options.onActivate),
    codeCopied.of(options.onCodeCopied),
    attachmentEvents(options.saveAttachment),
    urlPasteLink, // 画像の取り込みが先、URL のリンク化が後
    EditorView.lineWrapping,
    selectionDrawing, // 選択は状態から描く（WebKit の塗り残しを断つ）
  ];
}

/// 埋め込みの中の埋め込みは解決しない（深さ 1）
const NO_EMBED_RESOLVER: EmbedResolver = {
  resolve: async () => null,
  open: () => {},
};

/// ベンチや試験で使う「何もしない」差し替え
export const NOOP_CORE: Omit<
  CoreOptions,
  "highlights" | "focus" | "typewriter"
> = {
  tagSource: () => [],
  noteSource: () => [],
  resolveImage: async () => null,
  resolveEmbed: NO_EMBED_RESOLVER,
  onActivate: () => {},
  onCodeCopied: () => {},
  saveAttachment: async () => null,
};
