import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
// **クリップボードは Rust 側から触る**（要望 2026-09-04）。WebView の
// `navigator.clipboard.readText()` は許可が下りず、貼り付けが動かなかった
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";
import { Editor, type EditorHandle } from "./editor/Editor";
import { useAssistant } from "./hooks/useAssistant";
import { useNoteSync } from "./hooks/useNoteSync";
import { useSearch } from "./hooks/useSearch";
import { AssistantPane } from "./components/AssistantPane";
import { BacklinkBar } from "./components/BacklinkBar";
import { ChoiceDialog } from "./components/ChoiceDialog";
import { ContextMenu } from "./components/ContextMenu";
import { FolderSection } from "./components/FolderSection";
import { FormatToolbar } from "./components/FormatToolbar";
import { FuzzyPalette } from "./components/FuzzyPalette";
import { GraphDialog } from "./components/GraphDialog";
import { HistoryDialog } from "./components/HistoryDialog";
import { ListControls } from "./components/ListControls";

import { ListPalette } from "./components/ListPalette";
import { MenuIcon, PathIcon } from "./components/MenuIcon";
import { MenuList, type MenuEntry } from "./components/MenuList";
import { NoteActions } from "./components/NoteActions";
import { NoteTitle } from "./components/NoteTitle";
import { NoteRows } from "./components/NoteRows";
import { OutlinePane } from "./components/OutlinePane";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { PromptDialog } from "./components/PromptDialog";
import { SavedSearchSection } from "./components/SavedSearchSection";
import { SearchHits } from "./components/SearchHits";
import { StatusBar } from "./components/StatusBar";
import { StyleCheckDialog } from "./components/StyleCheckDialog";

import { TableDialog } from "./components/TableDialog";
import { TagSection } from "./components/TagSection";
import { TrashRows } from "./components/TrashRows";

import type { FormatKind } from "./editor/format-commands";
import { FORMAT_TOOLBAR } from "./editor/format-toolbar";
import { anchorAbove } from "./lib/context-menu";
import {
  AI_HANDOFFS,
  confirmMessage,
  dictUrl,
  handoffUrl,
  needsConfirm,
  searchUrl,
  SEARCH_HANDOFF,
  type Handoff,
} from "./lib/handoff";
import { finderTarget, TRASH_FOLDER } from "./lib/finder";
import { APP_NAME } from "./lib/app-name";
import { noteLabel, noteStem, nfcUnder } from "./lib/note-path";
import { firstHeading, sanitizeStem } from "./lib/note-title";
import { windowTitle } from "./lib/window-title";
import { ocrFailureText, ocrReaderFrom } from "./lib/ocr";
import {
  folderDepth,
  folderLabel,
  newNoteFolder,
  splitFolders,
} from "./lib/folder-tree";
import { dayValue } from "./lib/day";
import { folderFilterLabel, trashLabel } from "./lib/trash-label";
import { canDropInto, isFileDrag, isNoteDrag } from "./lib/note-drop";
import {
  availableFonts,
  BODY_FONTS,
  CODE_FONTS,
  FONT_SAMPLE,
  fontStack,
  type Measure,
} from "./lib/fonts";
import type { Activation } from "./editor/activation";
import type { OutlineItem } from "./editor/outline";
import type { TextStats } from "./editor/stats";
import {
  collectMermaid,
  renderMermaid,
  type MermaidTheme,
} from "./editor/mermaid";
import {
  referenceLives,
  restoreRightPane,
  RIGHT_PANE_KEY,
  type RightPane,
  togglePane,
} from "./lib/right-pane";
import { safeSubscribe } from "./lib/subscribe";
import { createDebouncer } from "./lib/debounce";
import {
  codeKey,
  collectCodeBlocks,
  renderBody,
  renderHtml,
} from "./lib/export-html";
import { highlightCodeHtml } from "./lib/export-code";
import {
  diagramsAsImages,
  MERMAID_IMAGE_PREFIX,
  splitDeck,
} from "./lib/slides";
import {
  rasterizeIfSvg,
  svgFromDataUrl,
  svgNaturalSize,
  svgToPng,
} from "./lib/svg-png";
import { extractNote } from "./lib/extract";
import { buildGraph, DEFAULT_DEPTH, graphToMermaid } from "./lib/graph";
import { checkStyle, type Finding } from "./lib/style-check";
import { buildPptx, readTemplateTheme } from "./lib/pptx";
import { readSlideTheme, slideThemeFrom } from "./lib/slide-theme";
import { slideMetrics } from "./lib/slide-grid";
import { overflowingSlides } from "./lib/slide-lint";
import { splitForDensity } from "./lib/slide-split";
import {
  DEFAULT_PPTX_SETTINGS,
  loadPptxSettings,
  resetPptxSettings,
  savePptxSettings,
  type PptxSettings,
} from "./lib/pptx-settings";
import { readPptx, slidesToMarkdown } from "./lib/pptx-import";
import { toMarkdown } from "./lib/imported";
import { fillBlankPages, pdfPages } from "./lib/pdf-import";
import {
  clampFontSize,
  DEFAULT_FONT_PX,
  FONT_STEP_PX,
  loadFontSize,
  saveFontSize,
  zoomActionFor,
} from "./lib/font-size";
import {
  forgetLastNote,
  lastNoteFor,
  restoreLastVault,
  saveLastNote,
  saveLastVault,
  vaultErrorText,
} from "./lib/last-vault";
import {
  clampPaneWidth,
  contentWidthCss,
  DEFAULT_SETTINGS,
  loadSettings,
  resolveTheme,
  saveSettings,
  type Settings,
} from "./lib/settings";
import {
  createNote,
  deleteForever,
  emptyTrash,
  historyList,
  historyUsage,
  llmModels,
  ocrImage,
  ocrPdfPage,
  createFolder,
  duplicateNote,
  registerTemplate,
  createFromTemplate,
  dailyNote,
  deleteFolder,
  linkMap,
  moveNote,
  noteBacklinks,
  moveFolder,
  renameFolder,
  syncIndex,
  trashAttachments,
  unusedAttachments,
  historyRestore,
  imageSource,
  placeManual,
  templateList,
  pinNote,
  readNote,
  saveAttachment,
  renameNote,
  setWindowTitle,
  restoreNote,
  trashNote,
  writeNote,
  type Backlink,
  type HistoryEntry,
  type SyncResult,
} from "./lib/ipc";
import { useAppStore } from "./stores/app";
import "./App.css";

// Phase 1 の骨格 UI: フォルダを開く → ノート一覧 → 編集 → 800ms 自動保存 →
// 新規・改名・ゴミ箱。3 ペイン構成・タグ・検索（spec §5.1）は後のフェーズで載せる。

function App() {
  const {
    vaultRoot,
    notes,
    tags,
    folders,
    trashNotes,
    currentPath,
    openVault,
    refresh,
    selectNote,
  } = useAppStore();
  const [doc, setDoc] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const editorRef = useRef<EditorHandle>(null);
  // メニューのハンドラは一度だけ登録するので、最新値は ref で読む
  const vaultRootRef = useRef(vaultRoot);
  vaultRootRef.current = vaultRoot;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  // 検索・絞り込み・並び順は hook に（ADR-0049）。欄のフォーカスと
  // 「検索を保存」の窓だけをここで持つ
  const search = useSearch({
    vaultRoot,
    notes,
    storage: localStorage,
    onStatus: setStatus,
  });
  const {
    query,
    hits,
    searches,
    tagFilter,
    folderFilter,
    trashView,
    sortOrder,
    sortedNotes,
    setQuery: handleQueryChanged,
    filterByTag,
    filterByFolder,
    changeSort,
  } = search;
  // メニューのハンドラは一度だけ登録するので、最新の式は ref で読む
  const queryRef = useRef(query);
  queryRef.current = query;
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 「検索を保存…」の名前入力。null は閉じている
  const [savingSearch, setSavingSearch] = useState<string | null>(null);

  function confirmSaveSearch(name: string) {
    const typed = savingSearch?.trim() ?? "";
    if (!typed) return;
    setSavingSearch(null);
    search.rememberSearch(name, typed);
    setStatus(`検索「${name}」を保存しました`);
  }

  // 環境設定（TASKS 3-9）。変えたらすぐ効かせて覚える
  const [settings, setSettings] = useState<Settings>(() =>
    loadSettings(localStorage),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 自動保存・退避・外部変更・競合は hook に（ADR-0049）。本文はエディタ
  // から手で読み書きし、hook は EditorView を持たない
  const sync = useNoteSync({
    vaultRoot,
    currentPath,
    historyMinutes: settings.historyMinutes,
    readText: () => editorRef.current?.getText() ?? "",
    replaceText: (text) => editorRef.current?.replaceText(text),
    onStatus: setStatus,
    refreshLists: refresh,
    onCloseNote: () => {
      selectNote(null);
      setDoc(null);
      forgetLastNote(localStorage);
    },
    onRecovered: async (written) => {
      if (written[0]) await openNote(written[0]);
    },
  });
  const { savedAt } = sync;
  // 環境設定ダイアログ（components/PreferencesDialog）。**開閉だけ**をここで
  // 持ち、タブやキャンセル用のスナップショットはダイアログの中で閉じる
  const [preferences, setPreferences] = useState(false);

  function openPreferences() {
    setPreferences(true);
  }

  /// 履歴フォルダの大きさ（環境設定の「履歴の使用量」）。vault が無ければ 0。
  /// ダイアログが開いている間に何度も聞かないよう、参照を固定する
  const loadHistoryUsage = useCallback((): Promise<number> => {
    const root = vaultRootRef.current;
    return root ? historyUsage(root) : Promise.resolve(0);
  }, []);

  /// Ollama に入っているモデル名（設定のモデル欄の選択肢）
  const loadInstalledModels = useCallback(
    (): Promise<string[]> => llmModels(settingsRef.current.llmPort),
    [],
  );

  function resetPreferences() {
    // ダイアログに出ている項目だけを既定へ（ペイン幅や開閉は触らない）
    changeSettings({
      theme: DEFAULT_SETTINGS.theme,
      contentWidth: DEFAULT_SETTINGS.contentWidth,
      bodyFont: DEFAULT_SETTINGS.bodyFont,
      monoFont: DEFAULT_SETTINGS.monoFont,
      tabWidth: DEFAULT_SETTINGS.tabWidth,
      indentedCode: DEFAULT_SETTINGS.indentedCode,
      lineSpacing: DEFAULT_SETTINGS.lineSpacing,
      historyMinutes: DEFAULT_SETTINGS.historyMinutes,
      trashDays: DEFAULT_SETTINGS.trashDays,
      llmModel: DEFAULT_SETTINGS.llmModel,
      llmPort: DEFAULT_SETTINGS.llmPort,
      llmContext: DEFAULT_SETTINGS.llmContext,
      llmTimeoutMinutes: DEFAULT_SETTINGS.llmTimeoutMinutes,
      llmKeepAlive: DEFAULT_SETTINGS.llmKeepAlive,
      ocrEngine: DEFAULT_SETTINGS.ocrEngine,
    });
    changeFontSize(DEFAULT_FONT_PX);
  }

  /// 左のペインは、中身が 1 つも無ければ畳む（空の帯を残さない）
  const leftVisible = settings.notesVisible || settings.treesVisible;

  /// ペインの幅をドラッグで変える（spec §5.1）。`direction` は掴んだ帯が
  /// 右へ動いたときに広がるなら 1、狭まるなら -1。
  function startResize(
    event: React.PointerEvent<HTMLDivElement>,
    key: "listWidth" | "outlineWidth",
    direction: 1 | -1,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = settingsRef.current[key];
    const move = (moved: PointerEvent) => {
      const width = clampPaneWidth(
        startWidth + (moved.clientX - startX) * direction,
        startWidth,
      );
      // 引きずっている間は覚えない（放したときに 1 回だけ書く）
      setSettings((current) => ({ ...current, [key]: width }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      saveSettings(localStorage, settingsRef.current);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    // pointerup が来ない経路（capture の横取り・フォーカス喪失）でも
    // move が生き残らないように（レビュー 2026-09-04）
    window.addEventListener("pointercancel", stop, { once: true });
  }

  function changeSettings(next: Partial<Settings>) {
    // 数値欄は空にすると 0 / NaN が入る（レビュー 2026-09-04）。読めない
    // 値はその項目だけ捨てて、直前の値を保つ
    const cleaned: Partial<Settings> = { ...next };
    for (const key of Object.keys(cleaned) as (keyof Settings)[]) {
      const value = cleaned[key];
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) || value <= 0)
      ) {
        delete cleaned[key];
      }
    }
    setSettings((current) => {
      const merged = { ...current, ...cleaned };
      saveSettings(localStorage, merged);
      return merged;
    });
  }

  // 本文の文字サイズ（Cmd+= / Cmd+-、TASKS 1-5）。変えたら覚える
  const [fontSize, setFontSize] = useState(() => loadFontSize(localStorage));
  function changeFontSize(px: number) {
    const next = clampFontSize(px);
    setFontSize(next);
    saveFontSize(localStorage, next);
  }
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  // 一覧の右クリックメニュー（ui/note_actions.py の役目）
  // 掴んでいるノートのパス。**ref で持つ** — dragover は毎フレーム飛ぶので、
  // 掴んだものまで state にすると打鍵と同じだけ再描画が走る
  const draggingNote = useRef<string | null>(null);
  // 横に開いたノート（U-1）。**読むだけ**なので、保存も監視も繋がない
  const [reference, setReference] = useState<{
    path: string;
    title: string;
    text: string;
  } | null>(null);
  // フォントの候補。**入っていないものは出さない**（要望 2026-09-04）。
  // Web からは端末のフォント一覧を列挙できないので、名前を挙げて 1 つずつ
  // 「その名前で組めるか」を幅で測る
  const measureFont = useMemo<Measure | null>(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    return (spec) => {
      context.font = spec;
      return context.measureText(FONT_SAMPLE).width;
    };
  }, []);
  const bodyFontChoices = useMemo(
    () => availableFonts(BODY_FONTS, measureFont),
    [measureFont],
  );
  const codeFontChoices = useMemo(
    () => availableFonts(CODE_FONTS, measureFont),
    [measureFont],
  );
  const [folderMenu, setFolderMenu] = useState<{
    folder: string;
    x: number;
    y: number;
  } | null>(null);
  const [tagMenu, setTagMenu] = useState<{
    tag: string;
    x: number;
    y: number;
  } | null>(null);
  // 歯車のメニューは**押したものの真上**に出す（下端にあるので上へ伸びる）
  const [gearMenu, setGearMenu] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [editorMenu, setEditorMenu] = useState<{
    x: number;
    y: number;
    selected: boolean;
  } | null>(null);
  const [trashMenu, setTrashMenu] = useState<{
    /// null なら「ゴミ箱そのもの」への操作（空にする）
    path: string | null;
    x: number;
    y: number;
  } | null>(null);
  // 「＋ 新規」の右クリック（作り方を選ぶ）。null は閉じている
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const [noteMenu, setNoteMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  // 「テンプレートに登録…」の名前入力。null は閉じている
  const [templateName, setTemplateName] = useState<string | null>(null);
  // 「フォルダへ移動…」の対象（右クリックからは開いていないノートも動かす）
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  // リンクの図（M-2）。null は閉じている
  const [graph, setGraph] = useState<{ svg: string; dropped: number } | null>(
    null,
  );
  const [graphDepth, setGraphDepth] = useState(DEFAULT_DEPTH);

  /// 開いているノートを起点に、リンクの図を出す。
  /// **絞らないと開けない**ので、深さで区切る（M-2）。
  async function showLinkGraph(depth: number) {
    if (!vaultRoot || !currentPath) return;
    setGraphDepth(depth);
    setStatus("リンクの図を組んでいます…");
    const links = (await linkMap(vaultRoot)).map(([from, to, relation]) => ({
      from,
      to,
      relation,
    }));
    const known = useAppStore
      .getState()
      .notes.map((entry) => noteStem(entry.path));
    const start = noteStem(currentPath);
    const built = buildGraph(start, links, { depth, known });
    const svg = await renderMermaid(
      graphToMermaid(built, [start]),
      diagramTheme,
    );
    if (!svg) {
      setStatus("図を組めませんでした");
      return;
    }
    setGraph({ svg, dropped: built.dropped });
    setStatus("");
  }

  /// 選んだところを別のノートに切り出し、元の場所に `[[題名]]` を残す
  /// （M-1 = 仮身化）。**題名は本文から決まる**ので、リンクの先は必ず解決する。
  async function handleExtract() {
    if (!vaultRoot || !currentPath) return;
    const selection = editorRef.current?.getSelection() ?? "";
    const taken = useAppStore
      .getState()
      .notes.map((entry) => noteStem(entry.path));
    const found = extractNote(selection, taken);
    if (!found) {
      setStatus("切り出す範囲を選んでください");
      return;
    }
    try {
      const path = await createNote(vaultRoot, found.title);
      await writeNote(
        vaultRoot,
        path,
        found.text,
        settingsRef.current.historyMinutes,
      );
      // **元の場所にはリンクだけ残す**（書いた文は新しいノートへ移った）。
      // リンクは**実際にできたファイル名**から組む — 題名の sanitize
      //（/ や : の置換、衝突時の連番）で found.title とずれると、
      // クリックのたびに 2 つ目のノートができる（レビュー 2026-09-04）
      const created = noteStem(path);
      editorRef.current?.replaceSelection(`[[${created}]]`);
      await sync.flush();
      await refresh();
      setStatus(`「${created}」に切り出しました`);
    } catch (error) {
      setStatus(`切り出せませんでした: ${String(error)}`);
    }
  }

  async function handleDuplicate(path: string) {
    if (!vaultRoot) return;
    await sync.flush(); // 打ちかけを書き切ってから写す
    try {
      const copy = await duplicateNote(vaultRoot, path);
      await refresh();
      await openNote(copy);
      setStatus("複製しました");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function confirmRegisterTemplate(typed: string) {
    const path = templateName;
    if (!vaultRoot || !path) return;
    setTemplateName(null);
    try {
      await registerTemplate(vaultRoot, path, typed);
      setStatus(`「${typed}」として登録しました（Cmd+Shift+N で使えます）`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// `[[名前]]` の形でクリップボードへ（別のノートから指すときに打ち直さない）。
  /// **知らせを出す** — クリップボードは目に見えないので、入ったか分からない。
  async function copyNoteLink(path: string) {
    const link = `[[${noteStem(path)}]]`;
    try {
      await writeClipboard(link);
      setStatus(`${link} をコピーしました`);
    } catch (error) {
      setStatus(`コピーできませんでした: ${String(error)}`);
    }
  }

  // 文体の指摘（U-4）。null は閉じている
  const [styleFindings, setStyleFindings] = useState<Finding[] | null>(null);

  /// 文体を見る。**まずパレットで出す** — 本文に波線を引くのは打鍵ごとの
  /// 経路に入る（spec §6.6 の 16ms）ので、「見たいときに見る」形から始める。
  /// **空のパレットは出さない**（何も無いことが分かればよい）。
  function checkStyleNow() {
    const text = editorRef.current?.getText() ?? "";
    const found = checkStyle(text);
    if (found.length === 0) {
      setStatus("気になるところはありませんでした");
      return;
    }
    setStyleFindings(found);
  }

  // 見出しパレット（Cmd+R、C-2）。**飛んだら閉じる道具**なので、
  // 出しっぱなしのアウトライン（Cmd+5）とは別に持つ
  const [headings, setHeadings] = useState<OutlineItem[] | null>(null);

  /// 今のノートの見出しでパレットを開く。**空のパレットは出さない**
  /// （何も無いことが分かればよい）。
  function openHeadingPalette() {
    const found = editorRef.current?.getOutline() ?? [];
    if (found.length === 0) {
      setStatus("このノートには見出しがありません");
      return;
    }
    setHeadings(found);
  }

  function jumpToHeading(item: OutlineItem | undefined) {
    if (!item) return;
    setHeadings(null);
    editorRef.current?.revealPos(item.from);
  }

  // PowerPoint の書き出し設定（TASKS 8-1 / 8-2）。**置き場は別の鍵** —
  // 大きな入れ子なので、ほかの設定と混ぜない
  const [pptxSettings, setPptxSettings] = useState<PptxSettings>(() => {
    try {
      return loadPptxSettings(localStorage);
    } catch {
      return DEFAULT_PPTX_SETTINGS;
    }
  });
  /// 開いているノートの本文を返す。環境設定の PowerPoint タブが「このノート」
  /// の下絵と収まり具合の見直し（GR-05）に使う。開いていなければ null。
  /// **currentPath ごとに 1 つ**にして、打鍵のたびに測り直させない
  const noteText = useMemo(
    () => (currentPath ? () => editorRef.current?.getText() ?? "" : null),
    [currentPath],
  );

  function changePptxSettings(patch: Partial<PptxSettings>) {
    setPptxSettings((current) => {
      const next = { ...current, ...patch };
      try {
        savePptxSettings(localStorage, next);
      } catch {
        // 置けなくてもこの回は効かせる
      }
      return next;
    });
  }

  // 「直下」は行ではなく見出しに出す（要望 2026-09-05）
  const { root: rootNotes, sub: subFolders } = splitFolders(folders);

  // 左下のフォルダ / タグは排他で開く（ユーザー要望 2026-09-04）。
  // 両方開くと一覧が痩せすぎる。開いた側が縦の約 1/3 を使う
  const [sideOpen, setSideOpen] = useState<"folders" | "tags" | null>(() => {
    try {
      const kept = localStorage.getItem("oboegaki.side");
      return kept === "folders" || kept === "tags" ? kept : "folders";
    } catch {
      return "folders";
    }
  });
  function toggleSide(kind: "folders" | "tags") {
    setSideOpen((current) => {
      const next = current === kind ? null : kind;
      try {
        localStorage.setItem("oboegaki.side", next ?? "");
      } catch {
        // 覚えられなくても開閉自体は生かす
      }
      return next;
    });
  }

  // クイックオープン（Cmd+O、spec §5.4）
  const [quickOpen, setQuickOpen] = useState(false);
  // HTML 書き出し（ADR-0007 の CM6 版）。画像は data URL に埋め込んで
  // 1 ファイルで持ち運べる形にする
  /// 図を先に描く（描画は非同期。書き出しにも印刷にも SVG を埋める）。
  async function drawDiagrams(text: string): Promise<Map<string, string>> {
    const diagrams = new Map<string, string>();
    for (const code of collectMermaid(text)) {
      const svg = await renderMermaid(code, diagramTheme);
      if (svg) diagrams.set(code, svg);
    }
    return diagrams;
  }

  /// Mermaid を PNG にする（PowerPoint 用。要望 2026-09-08）。**紙の上の図は
  /// 明るいテーマで描く** — アプリがダークでも紙は白地
  async function drawDiagramPngs(text: string): Promise<Map<string, string>> {
    const drawn = new Map<string, string>();
    for (const code of collectMermaid(text)) {
      const svg = await renderMermaid(code, "light");
      const png = svg ? await svgToPng(svg) : null;
      if (png) drawn.set(code, png);
    }
    return drawn;
  }

  /// コードを先に色分けする（パーサの読み込みが非同期。TASKS 4-4）。
  async function colorCode(text: string): Promise<Map<string, string>> {
    const colored = new Map<string, string>();
    for (const block of collectCodeBlocks(text)) {
      const html = await highlightCodeHtml(block.code, block.info);
      if (html) colored.set(codeKey(block.info, block.code), html);
    }
    return colored;
  }

  /// 画像を data URL にして埋める（**外部リソースを参照しない** = ADR-0007）。
  async function embedImages(html: string, root: string): Promise<string> {
    const tag = /<img src="([^"]+)"([^>]*)>/g;
    const sources = new Set([...html.matchAll(tag)].map((found) => found[1]));
    const resolved = new Map<string, string>();
    for (const src of sources) {
      const data = await imageSource(root, src);
      if (data) resolved.set(src, data);
    }
    return html.replace(tag, (whole, src: string, rest: string) => {
      const data = resolved.get(src);
      if (!data) return whole;
      // 幅の無い SVG は viewBox の大きさを書く（本文の絵と同じ理由。
      // 書き手が `|300` と書いた幅があればそちらを残す）
      const svg = svgFromDataUrl(data);
      const natural = svg === null ? null : svgNaturalSize(svg);
      const size =
        natural && !/\swidth="/.test(rest)
          ? ` width="${natural.width}" height="${natural.height}"`
          : "";
      return `<img src="${data}"${rest}${size}>`;
    });
  }

  /// 印刷（ADR-0038）。**書き出しと同じ本文**を隠しの領域に組み、
  /// `@media print` でそこだけを紙に出す。エディタ（CM6）は見えている
  /// 範囲しか DOM に無いので、そのまま刷ると本文が欠ける。
  async function handlePrint(forPdf = false) {
    if (!vaultRoot || !currentPath) return;
    // **PDF はここから先が OS の仕事。** 印刷の窓のどこを押せばよいかを
    // 先に言っておく（差分の調べ 2026-09-06: できるのに気づかれない）
    if (forPdf) {
      setStatus("印刷の窓の左下［PDF］から「PDF として保存」を選べます");
    }
    await sync.flush(); // 保存前の本文を刷らない
    const text = await readNote(vaultRoot, currentPath);
    const body = renderBody(
      text,
      await drawDiagrams(text),
      await colorCode(text),
    );
    setPrintBody({ html: await embedImages(body, vaultRoot), at: Date.now() });
  }

  /// PowerPoint に書き出す（TASKS 4-5 / F-5）。
  /// **ざっくり作って手で整える**前提。割り方は lib/slides.ts が決める。
  async function handleExportPptx() {
    if (!vaultRoot || !currentPath) return;
    await sync.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const target = await save({
      defaultPath: `${title}.pptx`,
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (!target) return;
    setStatus("PowerPoint を組んでいます…");
    try {
      // 土台は環境設定（8-1）、**ノートの front matter が勝つ**
      //（SC-02 > SC-01。ADR-0046 の決定 4）
      const metrics = slideMetrics(pptxSettings);
      // 収まらないぶんは次の枚へ送る（CFG-46）。**測ってから割る**ので、
      // 見張り（下）は割ったあとの姿を見ることになる
      // Mermaid は図（画像）として置く。描けなかった図はコードのまま
      const diagrams = await drawDiagramPngs(text);
      const deck = splitForDensity(
        diagramsAsImages(
          splitDeck(text, pptxSettings.layout.splitLevel),
          (source) => diagrams.has(source),
        ),
        pptxSettings,
        metrics,
      );
      // 書き出し前チェック（CFG-70）。**測り方は近似**なので、止めるのは
      // 「厳格」を選んだときだけ。ふだんは知らせて先へ進む
      const over =
        pptxSettings.advanced.lintLevel === "off"
          ? []
          : overflowingSlides(deck, metrics);
      if (over.length > 0 && pptxSettings.advanced.lintLevel === "strict") {
        setStatus(
          `${over.length} 枚で文字が収まらないかもしれません（${over
            .map((slide) => slide.title)
            .join("・")}）。書き出しを止めました`,
        );
        return;
      }
      const data = await buildPptx(
        deck,
        (url) =>
          url.startsWith(MERMAID_IMAGE_PREFIX)
            ? Promise.resolve(
                diagrams.get(url.slice(MERMAID_IMAGE_PREFIX.length)) ?? null,
              )
            : imageSource(vaultRoot, url).then(rasterizeIfSvg),
        readSlideTheme(text, slideThemeFrom(pptxSettings)),
        await borrowedTheme(),
        {
          footer: pptxSettings.footer,
          decoration: pptxSettings.decoration,
          metrics,
        },
      );
      await invoke("export_write_binary", { path: target, data });
      setStatus(
        over.length > 0
          ? `書き出しました: ${target}（${over.length} 枚で文字が収まらないかもしれません）`
          : `書き出しました: ${target}`,
      );
    } catch (error) {
      setStatus(`書き出せませんでした: ${String(error)}`);
    }
  }

  /// PDF のページを読む。**文字が取れないページだけ**読み取りに回す
  /// （ADR-0027 追記: 切り分けはページごと）。
  ///
  /// **ページ数は Rust にも訊く。** 文字の層が無い PDF（macOS の
  /// 「印刷 → PDF」や取り込んだ紙）では pdf.js が 1 ページも返さないことが
  /// あり、そのときページの並びが空だと**読み取りに一度も回らないまま
  /// 「文字を取り出せませんでした」で終わる**（実機報告 2026-09-05）。
  /// PDF のページの文字。文字の無いページだけ読み取りに回す（ADR-0027 追記）。
  /// 読み取りに失敗したページは空のまま残し、**読めたページは捨てない**。
  /// 失敗があれば知らせの文を返す
  async function readPdfPages(bytes: Uint8Array, data: string) {
    const pages = await pdfPages(bytes);
    const count =
      pages.length || (await invoke<number>("pdf_page_count", { data }));
    const reader = ocrReaderFrom(settingsRef.current);
    // **絵にするのも Rust の仕事**（同じ機械の中で完結させる）
    const found = await fillBlankPages(
      pages,
      count,
      (page) => ocrPdfPage(data, page, reader),
      (page, total) =>
        setStatus(`文字を読み取っています… ${page}/${total} ページ`),
    );
    const trouble =
      found.failed > 0
        ? `${found.failed} ページを読み取れませんでした — ${
            ocrFailureText(found.error) ?? String(found.error)
          }`
        : null;
    return { texts: found.texts, trouble };
  }

  /// PowerPoint を読み込んでノートにする（TASKS 4-5 / F-3）。
  /// **ざっくり読んで手で直す**前提。中身だけが残り、見た目は戻らない。
  async function handleImportPptx() {
    if (!vaultRoot) return;
    const picked = await open({
      filters: [
        {
          name: "読み込める資料",
          // 絵は読み取りに回す（ADR-0041）
          extensions: [
            "pdf",
            "pptx",
            "png",
            "jpg",
            "jpeg",
            "heic",
            "tiff",
            "tif",
          ],
        },
      ],
    });
    if (typeof picked !== "string") return;
    setStatus("読み込んでいます…");
    try {
      const data = await invoke<string>("import_read", { path: picked });
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const name = picked.split("/").pop() ?? "資料";
      const title = name.replace(/\.(pptx|pdf)$/i, "");
      // 形式ごとに読み方は違うが、**整えるのは同じ**（lib/imported.ts）
      let markdown: string;
      let trouble: string | null = null; // 読み取れなかったページの知らせ
      if (/\.(png|jpe?g|heic|tiff?)$/i.test(name)) {
        markdown = toMarkdown(
          [await ocrImage(data, ocrReaderFrom(settingsRef.current))],
          title,
        );
      } else if (/\.pdf$/i.test(name)) {
        const read = await readPdfPages(bytes, data);
        markdown = toMarkdown(read.texts, title);
        trouble = read.trouble;
      } else {
        markdown = slidesToMarkdown(title, await readPptx(bytes));
      }
      if (!markdown) {
        // 中身が無ければ題名だけのノートを作らせない
        setStatus("文字を取り出せませんでした");
        return;
      }
      const path = await createNote(vaultRoot, title);
      await writeNote(
        vaultRoot,
        path,
        markdown,
        settingsRef.current.historyMinutes,
      );
      await refresh();
      await openNote(path);
      setStatus(
        trouble ?? "読み込みました（見た目は戻りません。手で整えてください）",
      );
    } catch (error) {
      // 読み取りの失敗は人の言葉で（ADR-0027 決定 4）。それ以外はそのまま
      setStatus(
        ocrFailureText(error) ?? `読み込めませんでした: ${String(error)}`,
      );
    }
  }

  async function handleExport() {
    if (!vaultRoot || !currentPath) return;
    await sync.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const html = await embedImages(
      renderHtml(text, title, await drawDiagrams(text), await colorCode(text)),
      vaultRoot,
    );
    const target = await save({
      defaultPath: `${title}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!target) return;
    await invoke("export_write", { path: target, text: html });
    setStatus(`書き出しました: ${target}`);
  }

  // 表の挿入（TASKS 2-6）。行 × 列を聞いてから差し込む
  const [tableDialog, setTableDialog] = useState(false);
  // テンプレートの選択（E-4）。null は閉じている
  const [templates, setTemplates] = useState<string[] | null>(null);
  // フォルダの作成・改名の入力（ADR-0024）。null は閉じている
  const [folderDialog, setFolderDialog] = useState<{
    kind: "create" | "rename";
    folder: string; // create: 親（"" は直下）/ rename: 対象
  } | null>(null);
  // 「フォルダへ移動…」の行き先選び。null は閉じている
  const [moveOpen, setMoveOpen] = useState(false);
  // 雛形の `{{cursor}}`。開いた直後のキャレット位置としてエディタへ渡す
  const [initialCursor, setInitialCursor] = useState<number | null>(null);
  // このノートを指しているノート（E-6）。本文の下に畳んで出す
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  // 版の履歴（ADR-0023）
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(
    null,
  );

  async function openHistory() {
    if (!vaultRoot || !currentPath) return;
    await sync.flush(); // 未保存分を書き切ってから一覧を出す
    try {
      setHistoryEntries(await historyList(vaultRoot, currentPath));
    } catch (error) {
      setStatus(`履歴を開けませんでした: ${String(error)}`);
    }
  }

  async function restoreVersion(entry: HistoryEntry) {
    if (!vaultRoot || !currentPath) return;
    // **予約は聞く前に破棄する。** 確認ダイアログ中や書き戻しの直後に
    // 自動保存が発火すると、戻したはずの版が今の本文で潰れる
    //（レビュー 2026-09-04。openHistory が書き切っているので失うものは無い）
    sync.cancel();
    const ok = await confirm(
      `${entry.stamp} の版に戻しますか？\n（今の内容も履歴に残ります）`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    let text: string;
    try {
      text = await historyRestore(vaultRoot, currentPath, entry.path);
    } catch (error) {
      setStatus(`版を戻せませんでした: ${String(error)}`);
      return;
    }
    sync.adopt(text);
    setHistoryEntries(null);
    setStatus(`${entry.stamp} の版に戻しました`);
  }

  // 右のペイン（アウトライン Cmd+5 / アシスタント Cmd+6）。**1 つの状態で
  // 持つ**ので、同時に開くことがそもそも表現できない（ADR-0022 / lib/right-pane）
  const [rightPane, setRightPane] = useState<RightPane>(() =>
    restoreRightPane(localStorage),
  );
  const outlineOpen = rightPane === "outline";
  // 出ていないときは数えない（ADR-0022）。**登録し直さない購読**（エディタの
  // コールバック）から見るので ref で持つ
  const outlineOpenRef = useRef(outlineOpen);
  outlineOpenRef.current = outlineOpen;
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  // 目次の右クリック（7-1）。節ごと動かす
  const [outlineMenu, setOutlineMenu] = useState<{
    from: number;
    x: number;
    y: number;
  } | null>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const outlineSoon = useMemo(() => createDebouncer(300), []);
  // ステータスバーの統計（TASKS 3-10）。**打鍵ごとには数えない**
  // （全文の走査は 16ms の予算を食う）。打ち終わってからまとめて数える
  const [stats, setStats] = useState<TextStats>({ characters: 0, lines: 0 });
  const statsSoon = useMemo(() => createDebouncer(300), []);

  function toggleOutline() {
    const next = togglePane(rightPane, "outline");
    setRightPane(next);
    try {
      localStorage.setItem(RIGHT_PANE_KEY, next === "outline" ? "1" : "0");
    } catch {
      // 保存できなくても開閉自体は生かす
    }
  }

  // 隠れているときは数えない（ADR-0022）
  useEffect(() => {
    if (!outlineOpen) {
      setOutlineItems([]);
      return;
    }
    setOutlineItems(editorRef.current?.getOutline() ?? []);
  }, [outlineOpen, doc, currentPath]);

  async function chooseVault() {
    const picked = await open({ directory: true });
    if (typeof picked !== "string") return;
    await sync.flush(); // 前の vault の未保存分を書き切ってから移る
    try {
      await openVault(picked, settingsRef.current.trashDays);
    } catch (error) {
      // 二重起動の断りも含めて、開けない理由をそのまま見せる
      setStatus(vaultErrorText(error));
      return;
    }
    saveLastVault(localStorage, picked);
    setDoc(null);
  }

  // アシスタント（TASKS 4-8 / ADR-0025）。**無ければ機能ごと畳む**
  const assistantOpen = rightPane === "assistant";

  // 設定で切られたら、開いていても閉じる（切ったのに出たままにしない）
  useEffect(() => {
    if (!settings.assistantEnabled && assistantOpen) setRightPane("none");
  }, [settings.assistantEnabled, assistantOpen]);
  // Ollama の状態と処理は hook に（ADR-0049）。本文はエディタから手で読む
  const assistant = useAssistant({
    open: assistantOpen,
    vaultRoot,
    currentPath,
    notes,
    settings,
    flushEdits: () => sync.flush(),
    noteText: () => editorRef.current?.getText() ?? "",
    onStatus: setStatus,
  });

  // 表示モード（通常 / ソース）。**ノートを跨いで続く** — 切り替えボタンが
  // 見えているのに、ノートを開き直すと戻るのは筋が悪い
  const [sourceMode, setSourceMode] = useState(false);

  // 印刷用に組んだ本文（ADR-0038）。null なら一度も刷っていない。
  // **同じ本文をもう一度刷れるよう毎回別の値にする**（文字列だけだと
  // 2 回目の `Cmd+P` で state が変わらず、印刷パネルが出ない）
  const [printBody, setPrintBody] = useState<{
    html: string;
    at: number;
  } | null>(null);

  // 組み終わって**画面に出てから**印刷パネルを出す（先に呼ぶと、まだ
  // DOM に無いものが刷られる）
  useEffect(() => {
    if (printBody === null) return;
    const frame = requestAnimationFrame(() => {
      void invoke("print_page").catch((error) =>
        setStatus(`印刷できませんでした: ${String(error)}`),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [printBody]);

  // 図の見た目（ADR-0021）。新しく開くノートにも渡す
  const [diagramTheme, setDiagramTheme] = useState<MermaidTheme>("light");

  // 見た目（テーマ）。**「システムに合わせる」も含めて data-theme を書く** —
  // CSS 側に @media を持たせると、手で選んだ設定と 2 か所で決まってずれる
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(settings.theme, media.matches);
      document.documentElement.dataset.theme = resolved;
      setDiagramTheme(resolved);
      // 図もテーマに合わせて描き直す（ADR-0021）
      editorRef.current?.setDiagramTheme(resolved);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  // 開いた vault で**前回開いていたノート**を開く（要望 2026-09-08）。
  // 覚えが無い・もう無ければ**一番上のノート**（要望 2026-09-04）。
  //
  // **vault ごとに一度だけ。** 一覧が変わるたびに開き直すと、ノートを
  // 捨てたり絞り込んだりしたときに、勝手に別のノートへ飛んでしまう。
  // 既に何か開いていれば触らない（復元や引き継ぎを上書きしない）。
  const openedFirstFor = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultRoot || currentPath) return;
    if (openedFirstFor.current === vaultRoot) return;
    const remembered = lastNoteFor(localStorage, vaultRoot);
    const target =
      remembered && notes.some((entry) => entry.path === remembered)
        ? remembered
        : sortedNotes[0]?.path;
    if (!target) return; // 空の vault では何もしない
    if (remembered && target !== remembered) forgetLastNote(localStorage);
    openedFirstFor.current = vaultRoot;
    void openNote(target);
    // openNote は毎描画で作り直されるが、開くかどうかは上の条件で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultRoot, currentPath, notes, sortedNotes]);

  // 前回の vault を開き直す（TASKS 1-1）。覚えが無ければ既定の場所を開く
  // （ADR-0032 決定 3）。開けなければ黙って選択画面のまま
  useEffect(() => {
    if (vaultRootRef.current) return;
    const days = settingsRef.current.trashDays;
    void restoreLastVault(localStorage, (root) => openVault(root, days))
      .then(async (restored) => {
        if (restored) return;
        // **覚えていない人にフォルダを選ばせない。** 既定の場所を開いて、
        // 無ければそこに作る（`vault_open` が中身を整える）。
        // 場所を保存はしない — 保存すると、あとで新しい既定へ移った人が
        // 旧い場所に留まってしまう（既定値運用のまま置いておく）
        const fallback = await invoke<string>("default_vault");
        await openVault(fallback, days);
      })
      .catch((error) => {
        // 別の窓が同じ vault を開いている（記憶は消さない）
        setStatus(vaultErrorText(error));
      });
    // 起動時に一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openNote(given: string, cursor: number | null = null) {
    if (!vaultRoot) return;
    // 字面を索引・監視イベントと揃える（ADR-0050）。前回のノートの記憶などに
    // NFD が残っていても、開いたあとは NFC で持つ
    const path = nfcUnder(vaultRoot, given);
    await sync.flush(); // 前のノートの未保存分を書き切ってから切り替える
    let text: string;
    try {
      text = await readNote(vaultRoot, path);
    } catch (error) {
      // 一覧と実体がずれている（外で消された等）。無反応に見せない
      setStatus(`開けませんでした: ${String(error)}`);
      return;
    }
    selectNote(path);
    saveLastNote(localStorage, vaultRoot, path); // 次回の起動で開き直す
    setInitialCursor(cursor);
    setDoc(text);
    setEditorSession((session) => session + 1); // 別のノート = 作り直す
    sync.markOpened({ path, text });
    headingRef.current = firstHeading(text);
    setStatus("");
    setPrintBody(null); // 前のノートの印刷用の組みは捨てる（ADR-0038）
  }

  /// 新しいノート（Cmd+N・フォルダの右クリック）。
  /// フォルダを渡すとその中に作る（空文字は直下）。渡さなければ
  /// **絞っているフォルダの中**（要望 2026-09-07。lib/folder-tree）
  /// 「＋ 新規」に添える置き場所の説明
  const newNoteTitle = newNoteFolder(folderFilter)
    ? `「${newNoteFolder(folderFilter)}」の中に作る`
    : "直下に作る";

  async function handleCreate(folder = newNoteFolder(folderFilter)) {
    if (!vaultRoot) return;
    try {
      const path = await createNote(vaultRoot, "無題", folder);
      await refresh();
      await openNote(path);
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// テンプレートを選ぶ（Cmd+Shift+N）。**題名は聞かない** — 雛形の名前を
  /// そのまま題名にする（題名の欄で直せば見出しも追いかける = ADR-0005）。
  /// ダイアログを 2 枚重ねるより、開いてすぐ書けるほうが速い。
  async function chooseTemplate() {
    if (!vaultRoot) return;
    const found = await templateList(vaultRoot);
    if (found.length === 0) {
      setStatus(`「${vaultRoot}/templates」に .md を置くと、ここから使えます`);
      return;
    }
    setTemplates(found);
  }

  async function handleCreateFromTemplate(template: string) {
    if (!vaultRoot) return;
    setTemplates(null);
    const made = await createFromTemplate(vaultRoot, template);
    await refresh();
    await openNote(made.path, made.cursor);
  }

  /// 今日のノート（Cmd+T）。あれば開くだけ、無ければ日次の雛形から作る。
  /// **日付を渡せばその日のぶん**（7-5。昨日・先週に戻れる）。
  async function handleDailyNote(day?: string) {
    if (!vaultRoot) return;
    try {
      const made = await dailyNote(vaultRoot, day);
      await refresh();
      await openNote(made.path, made.cursor);
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// 日付を選ぶ窓（7-5）。既定は今日。
  const [dayDialog, setDayDialog] = useState<string | null>(null);
  function openDayDialog() {
    setDayDialog(dayValue(new Date()));
  }
  function confirmDay(day: string) {
    setDayDialog(null);
    void handleDailyNote(day);
  }

  /// 使い方のノートを今の内容で置き直す（ヘルプ）。既にあるノートは
  /// 消さず、別のファイルとして置かれる。
  async function handlePlaceManual() {
    if (!vaultRoot) return;
    const placed = await placeManual(vaultRoot);
    await refresh();
    await openNote(placed);
  }

  async function confirmFolderName(typed: string) {
    const dialog = folderDialog;
    if (!vaultRoot || !dialog) return;
    setFolderDialog(null);
    try {
      if (dialog.kind === "create") {
        const parent = dialog.folder ? `${dialog.folder}/` : "";
        await createFolder(vaultRoot, `${parent}${typed}`);
        setStatus(`フォルダ「${typed}」を作りました`);
      } else {
        const renamed = await renameFolder(vaultRoot, dialog.folder, typed);
        // 開いているノートのパスも変わっている。開き直して追いかける
        if (currentPath?.startsWith(`${vaultRoot}/${dialog.folder}/`)) {
          const moved = currentPath.replace(
            `${vaultRoot}/${dialog.folder}/`,
            `${vaultRoot}/${renamed}/`,
          );
          await sync.flush();
          await openNote(moved);
        }
        if (folderFilter === dialog.folder) filterByFolder(renamed);
        setStatus(`フォルダの名前を「${typed}」に変えました`);
      }
      await refresh();
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// フォルダを別のフォルダの中へ移す（サイドバーの Drag & Drop。要望
  /// 2026-09-10）。開いているノートがその中なら、新しいパスで開き直す
  async function handleMoveFolder(folder: string, into: string) {
    if (!vaultRoot) return;
    try {
      const moved = await moveFolder(vaultRoot, folder, into);
      if (moved === folder) return;
      if (currentPath?.startsWith(`${vaultRoot}/${folder}/`)) {
        const movedPath = currentPath.replace(
          `${vaultRoot}/${folder}/`,
          `${vaultRoot}/${moved}/`,
        );
        await sync.flush();
        await openNote(movedPath);
      }
      if (folderFilter === folder) filterByFolder(moved);
      setStatus(`フォルダ「${folder}」を「${into || "直下"}」へ移しました`);
      await refresh();
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// フォルダを消す。**ノートが入っていたら Rust 側が断る**（フォルダの
  /// 削除にゴミ箱は無いので、中身ごと消える操作は用意しない）。
  async function handleDeleteFolder(folder: string) {
    if (!vaultRoot) return;
    const ok = await confirm(`フォルダ「${folder}」を削除しますか？`, {
      title: "フォルダの削除",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await deleteFolder(vaultRoot, folder);
      if (folderFilter === folder) filterByFolder(null);
      await refresh();
      setStatus(`フォルダ「${folder}」を削除しました`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// このフォルダの行がこの落下を受けるか。
  ///
  /// **掴んでいるものは ref から見る。** 途中では `getData` が読めない
  /// 決まりなので、どのノートかは ref が知っている。ref を取り逃した
  /// ときのために、載せた目印（型）でも見分けられるようにしておく。
  function acceptsDrop(
    event: { dataTransfer: DataTransfer },
    folder: string,
  ): boolean {
    const dragged = draggingNote.current;
    if (dragged) return canDropInto(vaultRoot ?? "", dragged, folder);
    return isNoteDrag(Array.from(event.dataTransfer.types));
  }

  /// フォルダの行へ落とされたノートを移す（要望 2026-09-04）。
  ///
  /// **メニューの「フォルダへ移動…」と同じ道を通す**（`moveNote`）。
  /// 落としたのが開いているノートなら、動いた先を開き直す。
  async function handleDropOnFolder(path: string, folder: string) {
    if (!vaultRoot || !canDropInto(vaultRoot, path, folder)) return;
    const open = path === currentPath;
    if (open) await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const moved = await moveNote(vaultRoot, path, folder);
      await refresh();
      if (open) await openNote(moved);
      setStatus(
        folder
          ? `「${noteStem(path)}」を「${folder}」へ移しました`
          : `「${noteStem(path)}」を直下へ移しました`,
      );
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// 開いているノートをフォルダへ移す（ADR-0024）。本文は書き換えない。
  async function handleMoveNote(folder: string) {
    // 右クリックからは開いていないノートも動かす
    const path = moveTarget ?? currentPath;
    if (!vaultRoot || !path) return;
    setMoveOpen(false);
    setMoveTarget(null);
    await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const moved = await moveNote(vaultRoot, path, folder);
      await refresh();
      await openNote(moved);
      setStatus(folder ? `「${folder}」へ移しました` : "直下へ移しました");
    } catch (error) {
      setStatus(String(error));
    }
  }

  // Enter とフォーカス外しの両方から呼ばれるので、二重発火を弾く
  // （1 回目の改名で旧パスが消え、2 回目が「見つからない」で落ちる）
  const renaming = useRef(false);
  // エディタを作り直す単位（openNote ごとに進む。改名では進めない）
  const [editorSession, setEditorSession] = useState(0);
  // タイトルバーに文書の題名（要望 2026-09-10）。改名にも追従する
  useEffect(() => {
    setWindowTitle(windowTitle(currentPath)).catch(() => {});
  }, [currentPath]);

  async function handleRename(title: string) {
    if (!vaultRoot || !currentPath || renaming.current) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === noteStem(currentPath)) return;
    renaming.current = true;
    await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const renamed = await renameNote(vaultRoot, currentPath, trimmed);
      await refresh();
      const text = await readNote(vaultRoot, renamed);
      selectNote(renamed);
      saveLastNote(localStorage, vaultRoot, renamed);
      setDoc(text); // Rust が本文の見出しも書き換えている（ADR-0005）
      sync.markOpened({ path: renamed, text });
      headingRef.current = firstHeading(text);
    } catch (error) {
      setStatus(`改名に失敗: ${String(error)}`);
    } finally {
      renaming.current = false;
    }
  }

  // ---- 見出し → ファイル名（ADR-0005 追記、要望 2026-09-10）。保存が済んだ
  // あとに、本文の H1 が変わっていたらファイル名を追わせる。**ファイル名が
  // それまでの見出しに従っていたときだけ**動かす — Finder で意図して別名を
  // 付けたノートを保存のたびに改名しない（参照実装 _rename_if_title_changed）。
  // 見出しの無いノートはファイル名に従っているとみなす（無題に H1 を書けば
  // その名前になる）
  const headingRef = useRef<string | null>(null);
  async function followHeading() {
    if (!vaultRoot || !currentPath || renaming.current) return;
    const text = editorRef.current?.getText();
    if (text === undefined) return;
    const heading = firstHeading(text);
    const previous = headingRef.current;
    if (heading === previous) return;
    headingRef.current = heading;
    const stem = noteStem(currentPath);
    if (heading === null || sanitizeStem(previous ?? stem) !== stem) return;
    if (sanitizeStem(heading) === stem) return;
    renaming.current = true;
    try {
      const renamed = await renameNote(vaultRoot, currentPath, heading);
      if (renamed === currentPath) return;
      // 本文はそのまま（エディタを作り直さない = キャレットが飛ばない）。
      // 予約の書き先と今のパスだけ付け替える
      sync.renamed(currentPath, renamed);
      selectNote(renamed);
      saveLastNote(localStorage, vaultRoot, renamed);
      await refresh();
    } catch (error) {
      setStatus(`見出しに合わせた改名に失敗: ${String(error)}`);
    } finally {
      renaming.current = false;
    }
  }
  const followHeadingRef = useRef(followHeading);
  followHeadingRef.current = followHeading;
  useEffect(() => {
    if (savedAt === null) return;
    void followHeadingRef.current();
  }, [savedAt]);

  async function handleTrash(target?: string) {
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    // ピン留め中は削除ガード（spec §7.3）。Rust 側も拒むが、確認を
    // 出す前にここで止めるほうが親切
    if (notes.find((entry) => entry.path === path)?.pinned) {
      setStatus("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirm(
      `「${noteLabel(vaultRoot, path)}」をゴミ箱へ移しますか？`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    // 捨てるのが開いているノートなら、保存予約も破棄する
    if (path === currentPath) {
      sync.dropPending();
    }
    try {
      await trashNote(vaultRoot, path);
    } catch (error) {
      setStatus(String(error));
      return;
    }
    await refresh();
    if (path === currentPath) {
      selectNote(null);
      setDoc(null);
      forgetLastNote(localStorage);
    }
    setStatus("");
  }

  // ピン留めの付け外し（spec §7.3）。front matter が書き換わるので、
  // 開いているエディタの内容も返ってきた本文で差し替える
  async function handlePin(target?: string) {
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    const current = notes.find((entry) => entry.path === path);
    await sync.flush(); // 未保存分を書き切ってから front matter を触る
    let text: string;
    try {
      text = await pinNote(vaultRoot, path, !current?.pinned);
    } catch (error) {
      setStatus(`ピン留めに失敗: ${String(error)}`);
      return;
    }
    // 開いているノートなら、書き換わった front matter を読み直す
    if (path === currentPath) {
      sync.adopt(text);
    }
    await refresh();
    setStatus(current?.pinned ? "ピンを外しました" : "ピン留めしました");
  }

  /// テンプレートから借りる配色と書体（TASKS 5-6）。**読めなければ null** —
  /// テンプレートが壊れていても書き出しは止めない。
  async function borrowedTheme() {
    const path = settingsRef.current.slideTemplate;
    if (!path) return null;
    try {
      const base64 = await invoke<string>("import_read", { path });
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const parts = await readTemplateTheme(bytes);
      if (!parts)
        setStatus("テンプレートを読めませんでした（既定の見た目で出します）");
      return parts;
    } catch {
      setStatus("テンプレートを開けませんでした（既定の見た目で出します）");
      return null;
    }
  }

  /// PowerPoint のテンプレートを選ぶ（TASKS 5-6）。
  /// **場所を覚えるだけ** — 中身は書き出すときに読む（選んだあとに
  /// 差し替えられても、そのときの中身が使われる）。
  async function chooseSlideTemplate() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (typeof picked !== "string") return;
    changeSettings({ slideTemplate: picked });
  }

  /// ノートを横に開く（U-1）。**本文は入れ替えない** — 書いているノートを
  /// 奪わずに、もう 1 枚を並べるための道。読むだけなので保存も監視も繋がない。
  async function openBeside(path: string) {
    if (!vaultRoot) return;
    try {
      const text = await readNote(vaultRoot, path);
      setReference({ path, title: noteStem(path), text });
      setRightPane("reference");
    } catch (error) {
      setStatus(`横に開けませんでした: ${String(error)}`);
    }
  }

  /// 横のペインを閉じる。**本文は触らない。**
  function closeReference() {
    setReference(null);
    setRightPane("none");
  }

  // 横に出したノートが消えていたら畳む（参照実装 _forget_gone_reference）。
  // **もう無いものを読ませ続けない** — 直したつもりの内容を読み違える
  useEffect(() => {
    if (!reference) return;
    if (
      referenceLives(
        reference.path,
        notes.map((entry) => entry.path),
      )
    )
      return;
    setReference(null);
    setRightPane((pane) => (pane === "reference" ? "none" : pane));
  }, [notes, reference]);

  /// フォルダを Finder で開く（要望 2026-09-05）。
  ///
  /// **開ける先は保管フォルダの中だけ。** 画面から来た道をそのまま渡すと
  /// どこでも開けてしまうので、中かどうかは Rust 側で確かめる。
  async function openInFinder(folder: string) {
    const root = vaultRootRef.current;
    if (!root) return;
    try {
      await invoke("open_in_finder", {
        root,
        path: finderTarget(root, folder),
      });
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// 選んだ語を手元の辞書で引く（TASKS 7-2。ポメラの電子辞書相当）。
  ///
  /// **外へ出ない**（macOS の辞書が開くだけ）ので、確認の窓は挟まない。
  async function lookUpInDictionary() {
    const selected = editorRef.current?.getSelection() ?? "";
    const url = dictUrl(selected);
    if (!url) {
      setStatus("辞書で引くには、語を短く選んでください");
      return;
    }
    try {
      await invoke("open_handoff_url", { url });
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// 選んだ文字を外のサービスへ渡す（要望 2026-09-05）。
  ///
  /// **このアプリで初めて、ノートの中身が外へ出る道。** 押したときだけ動き、
  /// 渡すのは選んだところだけ。生成 AI の前には確認を挟む（環境設定で切れる）。
  async function handOff(handoff: Handoff) {
    const selected = editorRef.current?.getSelection() ?? "";
    if (!selected.trim()) return;
    if (needsConfirm(handoff, settingsRef.current.confirmHandoff)) {
      const ok = await confirm(confirmMessage(handoff, selected), {
        title: APP_NAME,
        kind: "warning",
      });
      if (!ok) return;
    }
    try {
      if (handoff.search) {
        await openUrl(searchUrl(selected));
        return;
      }
      // 文字ごと渡せるアプリには直接渡す（貼り付けが要らない）。
      // 渡せないアプリと、URL に載せきれない長さは**クリップボードに倒す**
      const direct = handoffUrl(handoff, selected);
      if (direct) {
        await invoke("open_handoff_url", { url: direct });
        setStatus(`${handoff.app} に渡しました`);
        return;
      }
      await writeClipboard(selected);
      await invoke("open_handoff_app", { app: handoff.app });
      setStatus(
        `クリップボードに入れて ${handoff.app} を開きました（⌘V で貼り付け）`,
      );
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// 本文の切り取り・コピー・貼り付け（右クリックのメニューから）。
  ///
  /// **クリップボードは Rust 側から触る。** WebView の
  /// `navigator.clipboard.readText()` は許可が下りず、貼り付けが動かなかった
  /// （実機報告 2026-09-04）。それでも失敗したときは Cmd+V を案内する。
  async function editorClipboard(action: "cut" | "copy" | "paste") {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      if (action === "paste") {
        const text = await readClipboard();
        if (text) editor.replaceSelection(text);
        return;
      }
      const selected = editor.getSelection();
      if (!selected) return;
      await writeClipboard(selected);
      if (action === "cut") editor.replaceSelection("");
    } catch {
      setStatus(
        action === "paste"
          ? "貼り付けられませんでした（Cmd+V で貼れます）"
          : "コピーできませんでした（Cmd+C で取れます）",
      );
    }
  }

  /// タグ名をコピーする。**`#` ごと**（本文に貼ればそのままタグになる）。
  async function copyTag(tag: string) {
    try {
      await writeClipboard(`#${tag}`);
      setStatus(`#${tag} をコピーしました`);
    } catch (error) {
      setStatus(`コピーできませんでした: ${String(error)}`);
    }
  }

  /// このタグで全ノート検索する（絞り込みと違い、本文まで見る）。
  ///
  /// **検索欄に打ったのと同じ道を通す**（`handleQueryChanged`）。
  /// `setQuery` だけでは欄の字が変わるだけで、探しに行かない。
  function searchByTag(tag: string) {
    handleQueryChanged(`#${tag}`);
    searchInputRef.current?.focus();
  }

  // このノートを指しているノートを引き直す（索引が更新されたときも）
  useEffect(() => {
    if (!vaultRoot || !currentPath) {
      setBacklinks([]);
      return;
    }
    let alive = true;
    const self = currentPath.slice(vaultRoot.length + 1);
    void noteBacklinks(vaultRoot, noteStem(currentPath))
      .then((found) => {
        // 自分自身は出さない（本文に `[[自分の題名]]` と書ける）
        if (alive) setBacklinks(found.filter((entry) => entry.path !== self));
      })
      .catch(() => {
        if (alive) setBacklinks([]);
      });
    return () => {
      alive = false;
    };
  }, [vaultRoot, currentPath, notes]);

  // Cmd+クリック（ADR-0010/0011）。ノートは無ければ作る
  async function handleActivate(action: Activation) {
    const root = vaultRootRef.current;
    if (!root) return;
    if (action.kind === "link") {
      void openUrl(action.payload);
      return;
    }
    if (action.kind === "tag") {
      filterByTag(action.payload);
      return;
    }
    const wanted = action.payload.toLowerCase();
    const target = useAppStore
      .getState()
      .notes.find((entry) => noteStem(entry.path).toLowerCase() === wanted);
    if (target) {
      await openNote(target.path);
      return;
    }
    const created = await createNote(root, action.payload);
    await refresh();
    await openNote(created);
  }

  async function handleRestore(path: string) {
    if (!vaultRoot) return;
    const restored = await restoreNote(vaultRoot, path);
    await refresh();
    await openNote(restored); // 戻したノートをそのまま開いて見せる
  }

  // 完全削除は取り返しがつかないので、必ず確認を挟む（G-3）
  async function handleDeleteForever(path: string) {
    if (!vaultRoot) return;
    const ok = await confirm(
      `「${trashLabel(vaultRoot, path)}」を完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await deleteForever(vaultRoot, path);
    await refresh();
  }

  async function handleEmptyTrash() {
    if (!vaultRoot) return;
    const ok = await confirm(
      `ゴミ箱の ${trashNotes.length} 件をすべて完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await emptyTrash(vaultRoot);
    await refresh();
  }

  function handleDocChanged(getText: () => string) {
    sync.noteChanged(getText);
    if (outlineOpenRef.current) {
      outlineSoon.schedule(() =>
        setOutlineItems(editorRef.current?.getOutline() ?? []),
      );
    }
    statsSoon.schedule(() =>
      setStats(editorRef.current?.getStats() ?? { characters: 0, lines: 0 }),
    );
  }

  // ノートを開いたら数え直す。**エディタが立ち上がったあと**に数える
  // （子の mount → 親の effect の順なので、ここでは既に新しい内容）
  useEffect(() => {
    statsSoon.cancel();
    setStats(editorRef.current?.getStats() ?? { characters: 0, lines: 0 });
  }, [doc, currentPath, statsSoon]);

  // グローバルショートカット（spec §5.4）。ハンドラは一度だけ登録し、
  // 最新の状態は ref 経由で読む
  function applyZoom(action: "in" | "out" | "reset") {
    if (action === "reset") changeFontSize(DEFAULT_FONT_PX);
    else
      changeFontSize(
        fontSizeRef.current + (action === "in" ? FONT_STEP_PX : -FONT_STEP_PX),
      );
  }
  const shortcutActions = useRef({ zoom: applyZoom });
  shortcutActions.current = { zoom: applyZoom };
  // **メニューに載せたショートカットはここで拾わない。** アクセラレータは
  // メニュー経由でも届くので、両方で拾うと 1 回の打鍵で動作が 2 回走る。
  // トグル（Cmd+5 / Cmd+O）は往復して何も起きず、Cmd+N は 2 枚できる
  // （実機で発覚 2026-09-04: アシスタントからアウトラインへ切り替わらない）。
  // ここに残すのは、メニュー側にアクセラレータを**あえて付けていない**
  // 文字サイズだけ（JIS 配列で Cmd+= が化けるため。lib.rs のコメント参照）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      // 文字サイズ（TASKS 1-5）。JIS 配列で正しく効くよう event.key で見る
      const zoom = zoomActionFor(event.key, event.shiftKey);
      if (zoom) {
        event.preventDefault();
        shortcutActions.current.zoom(zoom);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ネイティブメニュー（Rust 側 build_menu）からのイベント。
  // ハンドラは一度だけ登録し、最新の動作は ref 経由で読む
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    "new-note": () => void handleCreate(),
    "new-from-template": () => void chooseTemplate(),
    "daily-note": () => void handleDailyNote(),
    "pick-day": openDayDialog,
    "move-note": () => {
      if (currentPathRef.current) setMoveOpen(true);
    },
    "place-manual": () => void handlePlaceManual(),
    preferences: openPreferences,
    "open-vault": () => void chooseVault(),
    resync: () => void handleSync(false),
    "rebuild-index": () => void handleSync(true),
    "cleanup-attachments": () => void handleCleanupAttachments(),
    save: () => sync.flush(),
    "export-html": () => void handleExport(),
    "export-pptx": () => void handleExportPptx(),
    "export-pdf": () => void handlePrint(true),
    "import-pptx": () => void handleImportPptx(),
    print: () => void handlePrint(),
    history: () => void openHistory(),
    trash: () => void handleTrash(),
    "quick-open": () => {
      setQuickOpen((open) => !open);
    },
    "search-all": () => searchInputRef.current?.focus(),
    "save-search": () => {
      const typed = queryRef.current.trim();
      if (!typed) {
        setStatus("保存する検索式がありません（検索欄に打ってから）");
        return;
      }
      setSavingSearch(typed);
    },
    outline: toggleOutline,
    assistant: () => {
      // **切ってあるときは出さない**（要望 2026-09-04）。ただし黙って
      // 無視すると壊れて見えるので、どこで戻せるかを言う
      if (!settings.assistantEnabled) {
        setStatus("アシスタントは環境設定で切ってあります（Cmd+, で戻せます）");
        return;
      }
      setRightPane((pane) => togglePane(pane, "assistant"));
    },
    "llm-unload": () => void assistant.unloadModel(),
    "heading-palette": openHeadingPalette,
    "style-check": checkStyleNow,
    "toggle-trees": () =>
      changeSettings({ treesVisible: !settingsRef.current.treesVisible }),
    "toggle-notes": () =>
      changeSettings({ notesVisible: !settingsRef.current.notesVisible }),
    "format-heading": () => editorRef.current?.applyFormat("heading"),
    "format-bullet": () => editorRef.current?.applyFormat("bullet"),
    "format-ordered": () => editorRef.current?.applyFormat("ordered"),
    "format-quote": () => editorRef.current?.applyFormat("quote"),
    extract: () => void handleExtract(),
    "link-graph": () => void showLinkGraph(DEFAULT_DEPTH),
    "insert-table": () => {
      if (currentPathRef.current) setTableDialog(true);
    },
    "zoom-in": () => changeFontSize(fontSizeRef.current + FONT_STEP_PX),
    "zoom-out": () => changeFontSize(fontSizeRef.current - FONT_STEP_PX),
    "zoom-reset": () => changeFontSize(DEFAULT_FONT_PX),
    "source-mode": () => editorRef.current?.toggleSourceMode(),
    "focus-mode": () => editorRef.current?.toggleFocusMode(),
    typewriter: () => editorRef.current?.toggleTypewriterMode(),
  };
  useEffect(() => {
    const unlisten = safeSubscribe(() =>
      listen<string>("menu", (event) => {
        menuActions.current[event.payload]?.();
      }),
    );
    return unlisten;
  }, []);

  /// 使っていない添付を片づける（E-5）。
  ///
  /// **手で走らせる。** 起動のたびに動かすと、参照の取りこぼしが
  /// 「気づかないうちにファイルが動く」に直結する。件数を見せて、
  /// 押したときだけ動かす。
  async function handleCleanupAttachments() {
    if (!vaultRoot) return;
    // **書きかけの本文も数える。** 先に保存しないと、貼ったばかりの画像が
    // 「どこからも指されていない」ことになって消える
    await sync.flush();
    const found = await unusedAttachments(vaultRoot);
    if (found.length === 0) {
      setStatus("どの添付もノートから使われています");
      return;
    }
    const names = found
      .slice(0, 10)
      .map((path) => `・${path.split("/").pop()}`)
      .join("\n");
    const more = found.length > 10 ? `\n…ほか ${found.length - 10} 件` : "";
    const ok = await confirm(
      `どのノートからも使われていない添付が ${found.length} 件あります。\n` +
        `ゴミ箱へ移しますか？（${settingsRef.current.trashDays} 日は戻せます）\n\n${names}${more}`,
      { title: "使っていない添付を片づける", kind: "warning" },
    );
    if (!ok) return;
    const moved = await trashAttachments(vaultRoot, found);
    await refresh();
    setStatus(`${moved} 件をゴミ箱へ移しました`);
  }

  /// ファイルと索引を手で合わせ直す（M-6）。**打ちかけを先に書く**
  /// （走査は保存済みのものを読む）。
  async function handleSync(full: boolean) {
    if (!vaultRoot) return;
    await sync.flush();
    const started = await syncIndex(vaultRoot, full);
    if (!started) {
      setStatus("いま同期しています。終わるまでお待ちください");
      return;
    }
    setStatus(
      full
        ? "索引を作り直しています…（ノートの数だけ時間がかかります）"
        : "最新の情報に同期しています…",
    );
  }

  // 走査の結果を知らせる（M-6）。**「変わりはありません」まで言う** —
  // 変わらなかったことを言わないと、押した人には失敗と区別が付かない
  useEffect(() => {
    const unlisten = safeSubscribe(() =>
      listen<[boolean, SyncResult]>("index-synced", (event) => {
        const [full, result] = event.payload;
        const parts = [
          result.added > 0 && `${result.added} 件増えました`,
          result.updated > 0 && `${result.updated} 件変わりました`,
          result.removed > 0 && `${result.removed} 件消えました`,
        ].filter(Boolean);
        const head = full ? "索引を作り直しました" : "最新の情報に同期しました";
        setStatus(
          parts.length
            ? `${head}（${parts.join("、")}）`
            : `${head}（変わりはありません）`,
        );
        useAppStore
          .getState()
          .refresh()
          .catch((error) =>
            setStatus(`一覧を更新できませんでした: ${String(error)}`),
          );
      }),
    );
    return unlisten;
  }, []);

  useEffect(() => {
    const unlisten = safeSubscribe(() =>
      listen<string>("index-sync-failed", (event) => {
        setStatus(`索引の同期に失敗しました: ${event.payload}`);
      }),
    );
    return unlisten;
  }, []);

  // 背景の索引同期が終わったら一覧を引き直す（大きな vault の初回同期）
  useEffect(() => {
    const unlisten = safeSubscribe(() =>
      listen("index-updated", () => {
        useAppStore
          .getState()
          .refresh()
          .catch((error) =>
            setStatus(`一覧を更新できませんでした: ${String(error)}`),
          );
      }),
    );
    return unlisten;
  }, []);

  // 起動時間の実測（spec §6.6）。ベンチ時は Rust 側が印字して終了する
  useEffect(() => {
    invoke<number>("startup_elapsed_ms")
      .then((ms) => console.info(`起動 → UI マウント: ${ms}ms`))
      .catch(() => {}); // Tauri 外（素のブラウザ）では黙って無視
  }, []);

  if (!vaultRoot) {
    return (
      <main className="app app-empty">
        <h1>{APP_NAME}</h1>
        <button onClick={() => void chooseVault()}>保管フォルダを開く</button>
        {/* 開けなかった理由（二重起動の断りなど）はここにしか出せない */}
        {status && <p className="empty-note">{status}</p>}
      </main>
    );
  }

  // 現在地: キャレット位置以前の最後の見出し
  const currentOutlineIndex = (() => {
    let found = -1;
    outlineItems.forEach((item, index) => {
      if (item.from <= cursorPos) found = index;
    });
    return found;
  })();

  return (
    <>
      <main
        className="app"
        style={
          {
            "--editor-font-px": `${fontSize}px`,
            "--content-width": contentWidthCss(settings.contentWidth),
            "--list-width": `${settings.listWidth}px`,
            "--outline-width": `${settings.outlineWidth}px`,
            // フォントは空なら既定（システム / 既定の等幅スタック）のまま
            // **後ろに逃げ道を足す**（lib/fonts）。別の Mac で開いたときに
            // 無いフォントを指したままだと、本文が既定のセリフ体になる
            ...(settings.bodyFont
              ? { "--body-font": fontStack(settings.bodyFont) }
              : {}),
            ...(settings.monoFont
              ? {
                  "--mono-font": fontStack(
                    settings.monoFont,
                    "ui-monospace, Menlo, monospace",
                  ),
                }
              : {}),
          } as CSSProperties
        }
        data-spacing={settings.lineSpacing}
        // **窓ぜんぶで「動かす」として受けておく。** WebView（wry）は
        // 画面が「受けない」と答えた場所を **Copy に読み替える**ので、
        // macOS が緑の ＋ を出してしまう（wry 0.55.1 の
        // wkwebview/drag_drop.rs: None を NSDragOperation::Copy にする）。
        // 実際に動かすのはフォルダの行だけで、ここは受けるふりに徹する
        // **ファイルの落下も窓ぜんぶで受ける。** CM6 のイベントは本文の
        // 文字の領域にしか付かず、余白や題名の周りに落とすと誰も受けない。
        // 受けないと WebKit がそのファイルをページとして開いてしまう
        // （実機報告 2026-09-08: 画像が窓いっぱいに出た）
        onDragEnter={(event) => {
          const types = Array.from(event.dataTransfer.types);
          if (!isNoteDrag(types) && !isFileDrag(types)) return;
          event.preventDefault();
        }}
        onDragOver={(event) => {
          const types = Array.from(event.dataTransfer.types);
          if (isNoteDrag(types)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          } else if (isFileDrag(types)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const types = Array.from(event.dataTransfer.types);
          if (isNoteDrag(types)) {
            // フォルダの行で受けたものはそこで処理済み。ここへ来るのは
            // 落とし先でない場所なので、静かに捨てる（本文に文字を
            // 落とさない）
            event.preventDefault();
            draggingNote.current = null;
            return;
          }
          if (!isFileDrag(types)) return;
          // 本文の文字の上で落とされたぶんは CM6 が受けて preventDefault
          // 済みで届く。二重に挿さない
          const handled = event.defaultPrevented;
          event.preventDefault(); // どこに落とされても WebKit にページを開かせない
          if (handled) return;
          const files = Array.from(event.dataTransfer.files);
          const taken = editorRef.current?.dropFiles(files, {
            x: event.clientX,
            y: event.clientY,
          });
          if (!taken && currentPath === null) {
            setStatus("画像を貼り込むには、先にノートを開いてください");
          }
        }}
      >
        <div
          className={
            `app-split${rightPane !== "none" ? " with-outline" : ""}` +
            (leftVisible ? "" : " no-list")
          }
        >
          {leftVisible && (
            <aside className="note-list">
              {/* 一覧を畳んでいるときだけ、見出しに「＋ 新規」を残す。
                保管フォルダの変更は環境設定にある（要望 2026-09-04）。
                同じことをする入口を一覧の上にも置かない */}
              {!settings.notesVisible && (
                <header>
                  <button
                    title={newNoteTitle}
                    onClick={() => void handleCreate()}
                  >
                    ＋ 新規
                  </button>
                </header>
              )}
              {/* 検索欄 → 絞り込みのラベル → 並び順と「＋ 新規」の 3 段
                （要望 2026-09-07）。一覧と一緒に出し入れし、一覧より上に
                固定する（一緒にスクロールしない） */}
              {settings.notesVisible && (
                <>
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    type="search"
                    placeholder="検索"
                    value={query}
                    onChange={(event) =>
                      handleQueryChanged(event.currentTarget.value)
                    }
                  />
                  {tagFilter && (
                    <div className="tag-filter-row">
                      <span className="tag-filter-name">#{tagFilter}</span>
                      <button
                        className="tag-filter-clear"
                        onClick={() => filterByTag(null)}
                        title="絞り込みを解除"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  {folderFilter !== null && (
                    <div className="tag-filter-row">
                      <span className="tag-filter-name">
                        {folderFilterLabel(folderFilter)}
                      </span>
                      <button
                        className="tag-filter-clear"
                        onClick={() => filterByFolder(null)}
                        title="絞り込みを解除"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  <ListControls
                    sortOrder={sortOrder}
                    onSort={changeSort}
                    // 並び順はゴミ箱と検索の結果には効かない
                    showSort={!trashView && !query.trim()}
                    newTitle={newNoteTitle}
                    onNew={() => void handleCreate()}
                    onNewMenu={setNewMenu}
                  />
                </>
              )}
              {!settings.notesVisible ? null : query.trim() ? (
                <SearchHits
                  hits={hits}
                  onOpen={(path) => void openNote(`${vaultRoot}/${path}`)}
                />
              ) : (
                <div className="note-scroll">
                  {trashView ? (
                    <TrashRows
                      vaultRoot={vaultRoot}
                      entries={trashNotes}
                      currentPath={currentPath}
                      trashDays={settings.trashDays}
                      onOpen={(path) => void openNote(path)}
                      onMenu={setTrashMenu}
                    />
                  ) : (
                    <NoteRows
                      notes={sortedNotes}
                      currentPath={currentPath}
                      emptyText={
                        tagFilter
                          ? "このタグのノートはありません"
                          : folderFilter !== null
                            ? "このフォルダにノートはありません"
                            : null
                      }
                      onOpen={(path) => void openNote(path)}
                      onMenu={setNoteMenu}
                      onDragStart={(path) => {
                        draggingNote.current = path;
                      }}
                      onDragEnd={() => {
                        draggingNote.current = null;
                      }}
                    />
                  )}
                </div>
              )}
              {settings.treesVisible && searches.length > 0 && (
                <SavedSearchSection
                  searches={searches}
                  onRun={(query) => {
                    // 結果は一覧ペイン側に出る。閉じたままだと押しても
                    // 無反応に見える（レビュー 2026-09-04）
                    if (!settingsRef.current.notesVisible) {
                      changeSettings({ notesVisible: true });
                    }
                    handleQueryChanged(query);
                  }}
                  onRemove={search.forgetSearch}
                />
              )}
              {settings.treesVisible && (
                <FolderSection
                  folders={subFolders}
                  rootCount={rootNotes}
                  trashCount={trashNotes.length}
                  folderFilter={folderFilter}
                  open={sideOpen === "folders"}
                  onToggle={() => toggleSide("folders")}
                  onFilter={filterByFolder}
                  onFolderMenu={setFolderMenu}
                  onTrashMenu={({ x, y }) => setTrashMenu({ path: null, x, y })}
                  acceptsDrop={acceptsDrop}
                  onDrop={(folder, carried) => {
                    const dragged = draggingNote.current || carried;
                    draggingNote.current = null;
                    if (dragged) void handleDropOnFolder(dragged, folder);
                  }}
                  onDropTrash={(carried) => {
                    const dragged = draggingNote.current || carried;
                    draggingNote.current = null;
                    // ピン留めの断りと確認は handleTrash が持っている
                    if (dragged) void handleTrash(dragged);
                  }}
                  onDropFolder={(into, folder) =>
                    void handleMoveFolder(folder, into)
                  }
                  storage={localStorage}
                />
              )}
              {settings.treesVisible && tags.length > 0 && (
                <TagSection
                  tags={tags}
                  tagFilter={tagFilter}
                  open={sideOpen === "tags"}
                  onToggle={() => toggleSide("tags")}
                  onFilter={filterByTag}
                  onMenu={setTagMenu}
                />
              )}
            </aside>
          )}
          {/* 幅を掴む帯（spec §5.1）。**ペインの外に置く** — 中に入れると
          一覧のスクロールに乗って、下までスクロールすると掴めなくなる */}
          {leftVisible && (
            <div
              className="pane-resizer list"
              title="幅を変える"
              onPointerDown={(event) => startResize(event, "listWidth", 1)}
            />
          )}
          {rightPane !== "none" && (
            <div
              className="pane-resizer outline"
              title="幅を変える"
              onPointerDown={(event) => startResize(event, "outlineWidth", -1)}
            />
          )}
          {headings !== null && (
            <FuzzyPalette
              placeholder="見出しへ飛ぶ"
              // 空の見出し（`##` だけの行）も選べるようにする
              labels={headings.map((item) => item.text || "（無題の見出し）")}
              limit={30}
              // 字下げで階層を見せる（深さを数字で出しても読み取りにくい）
              indentOf={(index) => (headings[index].level - 1) * 0.9}
              onChoose={(index) => jumpToHeading(headings[index])}
              onClose={() => setHeadings(null)}
            />
          )}
          {quickOpen && (
            <FuzzyPalette
              placeholder="ノート名で開く"
              labels={notes.map((entry) => entry.label)}
              limit={20}
              onChoose={(index) => {
                setQuickOpen(false);
                void openNote(notes[index].path);
              }}
              onClose={() => setQuickOpen(false)}
            />
          )}
          <section className="editor-pane">
            {doc !== null && currentPath !== null ? (
              <>
                {/* 題名の行は本文と同じ幅で中央に置くので、区切り線は
                  外側の帯に引く（線だけが短いと途中で切れて見える） */}
                <div className="note-header-bar">
                  <NoteTitle
                    key={currentPath}
                    path={currentPath}
                    onRename={(name) => void handleRename(name)}
                  />
                  {/* 操作はアイコンでペインの右端に寄せる（題名の 46rem 幅とは
                    独立。ユーザー要望 2026-09-04）。並びは
                    ピン → 書き出し → 履歴 → ゴミ箱 → ソース表示切替 */}
                  <NoteActions
                    pinned={
                      notes.find((entry) => entry.path === currentPath)
                        ?.pinned ?? false
                    }
                    sourceMode={sourceMode}
                    onPin={() => void handlePin()}
                    onExport={() => void handleExport()}
                    onHistory={() => void openHistory()}
                    onTrash={() => void handleTrash()}
                    onToggleSource={() =>
                      editorRef.current?.setSourceMode(!sourceMode)
                    }
                  />
                </div>
                <FormatToolbar
                  onFormat={(kind) => editorRef.current?.applyFormat(kind)}
                  onTable={() => setTableDialog(true)}
                />
                <Editor
                  // **ノートを開いた回数で作り直す。パスでは作り直さない** —
                  // 見出しに合わせた改名（3-30）でパスが変わると、開いたときの
                  // 本文で初期化され、打った内容が消える（実機 2026-09-10）。
                  // 打った内容はエディタだけが持つ（T2）
                  key={editorSession}
                  ref={editorRef}
                  initialDoc={doc}
                  onDocChanged={handleDocChanged}
                  resolveImage={(url) => imageSource(vaultRoot, url)}
                  onActivate={(action) => void handleActivate(action)}
                  onCursorChanged={(pos) => {
                    if (outlineOpenRef.current) setCursorPos(pos);
                  }}
                  // **OS の既定のメニューを出さない**（要望 2026-09-04）。
                  // 「Google で検索」「共有」など、本文を外へ出す道が並ぶ
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setEditorMenu({
                      x: event.clientX,
                      y: event.clientY,
                      selected:
                        (editorRef.current?.getSelection() ?? "") !== "",
                    });
                  }}
                  saveAttachment={(data, name) =>
                    saveAttachment(vaultRoot, data, name)
                  }
                  // 索引の持つタグを補完に出す。ストアから直に読む（tags を
                  // props で渡すと、タグが増えるたびにエディタが作り直される）
                  knownTags={() =>
                    useAppStore.getState().tags.map((entry) => entry.tag)
                  }
                  // `[[` 補完の候補。題名はファイル名の幹（ADR-0005）なので
                  // 一覧から作れる（打鍵ごとに Rust を呼ばない）
                  knownNotes={() =>
                    useAppStore
                      .getState()
                      .notes.map((entry) => noteStem(entry.path))
                  }
                  initialCursor={initialCursor}
                  diagramTheme={diagramTheme}
                  sourceMode={sourceMode}
                  onSourceModeChanged={setSourceMode}
                />
              </>
            ) : (
              <p className="placeholder">ノートを選んでください</p>
            )}
            {backlinks.length > 0 && (
              <BacklinkBar
                backlinks={backlinks}
                onOpen={(path) => void openNote(`${vaultRoot}/${path}`)}
              />
            )}
          </section>
          {templates !== null && (
            <ListPalette
              title="テンプレートを選ぶ"
              items={templates.map((path) => ({
                key: path,
                label: noteStem(path),
              }))}
              onChoose={(index) =>
                void handleCreateFromTemplate(templates[index])
              }
              onClose={() => setTemplates(null)}
            />
          )}
          {/* 日付を選んでその日のノートへ（7-5。ポメラの日付メモ相当） */}
          {dayDialog !== null && (
            <PromptDialog
              title="日付を選んで開く"
              label="日付"
              type="date"
              defaultValue={dayDialog}
              note="その日のノートが無ければ、日次の雛形から作ります。"
              confirmLabel="開く"
              onConfirm={confirmDay}
              onClose={() => setDayDialog(null)}
            />
          )}
          {folderDialog !== null && (
            <PromptDialog
              title={
                folderDialog.kind === "create"
                  ? folderDialog.folder
                    ? `「${folderDialog.folder}」の中に新しいフォルダ`
                    : "新しいフォルダ"
                  : `「${folderDialog.folder}」の名前を変更`
              }
              label="名前"
              defaultValue={
                folderDialog.kind === "rename"
                  ? folderLabel(folderDialog.folder)
                  : ""
              }
              confirmLabel="決定"
              onConfirm={(typed) => void confirmFolderName(typed)}
              onClose={() => setFolderDialog(null)}
            />
          )}
          {moveOpen && (
            <ListPalette
              title="フォルダへ移動"
              items={folders.map(({ folder }) => ({
                key: folder || ".",
                label: folderLabel(folder),
                indent: folderDepth(folder),
              }))}
              onChoose={(index) => void handleMoveNote(folders[index].folder)}
              onClose={() => setMoveOpen(false)}
            />
          )}
          {preferences && (
            <PreferencesDialog
              settings={settings}
              onChangeSettings={changeSettings}
              fontSize={fontSize}
              onChangeFontSize={changeFontSize}
              vaultRoot={vaultRoot}
              onChooseVault={() => void chooseVault()}
              onChooseSlideTemplate={() => void chooseSlideTemplate()}
              pptxSettings={pptxSettings}
              onChangePptxSettings={changePptxSettings}
              onResetPptxSettings={() => {
                resetPptxSettings(localStorage);
                setPptxSettings(DEFAULT_PPTX_SETTINGS);
              }}
              onReset={resetPreferences}
              onClose={() => setPreferences(false)}
              noteText={noteText}
              historyUsage={loadHistoryUsage}
              installedModels={loadInstalledModels}
              bodyFontChoices={bodyFontChoices}
              codeFontChoices={codeFontChoices}
            />
          )}
          {tableDialog && (
            <TableDialog
              onInsert={(rows, columns) => {
                setTableDialog(false);
                editorRef.current?.insertTable(rows, columns);
              }}
              onClose={() => setTableDialog(false)}
            />
          )}
          {sync.recovery > 0 && (
            <ChoiceDialog
              title="保存されていない変更が見つかりました"
              text={`前回終了したときに保存されていない変更が ${sync.recovery} 件あります。別のファイルとして復元しますか？（今あるノートは書き換えません）`}
              choices={[
                {
                  label: "復元しない",
                  onChoose: () => void sync.handleRecovery(false),
                },
                {
                  label: "復元する",
                  onChoose: () => void sync.handleRecovery(true),
                },
              ]}
            />
          )}
          {newMenu !== null && (
            <ContextMenu at={newMenu} onClose={() => setNewMenu(null)}>
              {/* 左クリックは無題のノート。ここは**別の作り方**だけを並べる
                  （メニューバーの「ファイル」と同じ動作を使い回す） */}
              <MenuList
                onPick={() => setNewMenu(null)}
                items={[
                  {
                    label: "テンプレートから新規…",
                    icon: <MenuIcon name="template" />,
                    onSelect: () => void chooseTemplate(),
                  },
                  {
                    label: "今日のノート",
                    icon: <MenuIcon name="noteNew" />,
                    onSelect: () => void handleDailyNote(),
                  },
                ]}
              />
            </ContextMenu>
          )}
          {noteMenu !== null &&
            (() => {
              const target = noteMenu.path;
              const pinned = notes.find(
                (entry) => entry.path === target,
              )?.pinned;
              return (
                <ContextMenu at={noteMenu} onClose={() => setNoteMenu(null)}>
                  <MenuList
                    onPick={() => setNoteMenu(null)}
                    items={[
                      {
                        label: pinned ? "ピンを外す" : "ピン留め",
                        icon: <MenuIcon name="pin" />,
                        onSelect: () => void handlePin(target),
                      },
                      // **本文を入れ替える「開く」とは別の道**（U-1）。
                      // 書いているノートを奪わずに、もう 1 枚を並べる
                      {
                        label: "横に開く",
                        icon: <MenuIcon name="beside" />,
                        onSelect: () => void openBeside(target),
                      },
                      {
                        label: "複製",
                        icon: <MenuIcon name="copy" />,
                        onSelect: () => void handleDuplicate(target),
                      },
                      {
                        label: "フォルダへ移動…",
                        icon: <MenuIcon name="move" />,
                        onSelect: () => {
                          setMoveTarget(target);
                          setMoveOpen(true);
                        },
                      },
                      {
                        label: "テンプレートに登録…",
                        icon: <MenuIcon name="template" />,
                        onSelect: () => setTemplateName(target),
                      },
                      { kind: "separator" },
                      {
                        label: "リンクをコピー",
                        icon: <MenuIcon name="link" />,
                        onSelect: () => void copyNoteLink(target),
                      },
                      {
                        label: "Finder で表示",
                        icon: <MenuIcon name="finder" />,
                        onSelect: () => void revealItemInDir(target),
                      },
                      { kind: "separator" },
                      {
                        label: "ゴミ箱へ移動",
                        icon: <MenuIcon name="trash" />,
                        danger: true,
                        disabled: pinned,
                        title: pinned
                          ? "ピン留め中は捨てられません"
                          : "ゴミ箱へ移動",
                        onSelect: () => void handleTrash(target),
                      },
                    ]}
                  />
                </ContextMenu>
              );
            })()}
          {editorMenu !== null &&
            (() => {
              const selected = editorMenu.selected;
              // 書式の絵は**ツールバーと同じもの**を引く（同じ言葉に同じ絵）
              const format = (kind: FormatKind, label: string): MenuEntry => ({
                label,
                icon: (
                  <PathIcon
                    className="menu-icon"
                    paths={
                      FORMAT_TOOLBAR.flat().find((found) => found.kind === kind)
                        ?.paths ?? []
                    }
                    strokeWidth={1.3}
                  />
                ),
                onSelect: () => editorRef.current?.applyFormat(kind),
              });
              const handoffIcon = <MenuIcon name="handoff" />;
              return (
                <ContextMenu
                  at={editorMenu}
                  onClose={() => setEditorMenu(null)}
                >
                  <MenuList
                    onPick={() => setEditorMenu(null)}
                    items={[
                      // 選んでいないときは押せない状態で見せる
                      // （項目ごと消すと、なぜ無いのか分からない）
                      {
                        label: "切り取り",
                        icon: <MenuIcon name="cut" />,
                        disabled: !selected,
                        onSelect: () => void editorClipboard("cut"),
                      },
                      {
                        label: "コピー",
                        icon: <MenuIcon name="copy" />,
                        disabled: !selected,
                        onSelect: () => void editorClipboard("copy"),
                      },
                      {
                        label: "貼り付け",
                        icon: <MenuIcon name="paste" />,
                        onSelect: () => void editorClipboard("paste"),
                      },
                      { kind: "separator" },
                      format("strong", "太字"),
                      format("emphasis", "斜体"),
                      format("code", "コード"),
                      format("link", "リンク"),
                      { kind: "separator" },
                      format("heading", "見出し"),
                      format("bullet", "箇条書き"),
                      format("quote", "引用"),
                      { kind: "separator" },
                      {
                        label: "表を挿入…",
                        icon: <MenuIcon name="table" />,
                        onSelect: () => setTableDialog(true),
                      },
                      { kind: "separator" },
                      // **外へ出る道**（要望 2026-09-05）。生成 AI は 4 つを
                      // 枝にまとめる — 平らに並べるとメニューの半分を占める。
                      // 選んでいないときは押せない状態で見せる（渡すものが無い）
                      selected
                        ? {
                            kind: "submenu",
                            label: "生成AIに渡す",
                            icon: handoffIcon,
                            items: AI_HANDOFFS.map((handoff) => ({
                              label: handoff.name,
                              onSelect: () => void handOff(handoff),
                            })),
                          }
                        : {
                            label: "生成AIに渡す",
                            icon: handoffIcon,
                            disabled: true,
                            onSelect: () => {},
                          },
                      {
                        label: SEARCH_HANDOFF.label,
                        icon: <MenuIcon name="search" />,
                        disabled: !selected,
                        onSelect: () => void handOff(SEARCH_HANDOFF),
                      },
                      // 手元の辞書（7-2。ポメラの電子辞書相当）。**外へ出ない**
                      // ので、生成 AI のような確認は挟まない
                      {
                        label: "辞書で調べる",
                        icon: <MenuIcon name="dictionary" />,
                        disabled: !selected,
                        onSelect: () => void lookUpInDictionary(),
                      },
                    ]}
                  />
                </ContextMenu>
              );
            })()}
          {gearMenu !== null &&
            (() => {
              // 参照実装（ui/menus.build_gear_menu）と同じ考え方:
              // **メニューバーと同じ動作を使い回し、よく使うものだけ**。
              // 全部の写しにすると、探す手間がメニューバーと変わらない
              const menu = menuActions.current;
              return (
                // 歯車は**押した絵の真上**に出す（測って置くのではなく、
                // 下端を歯車に合わせる = lib/context-menu の anchorAbove）
                <div
                  className="menu-backdrop"
                  onMouseDown={() => setGearMenu(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setGearMenu(null);
                  }}
                >
                  <ul
                    className="context-menu"
                    style={anchorAbove(gearMenu, 230, {
                      width: window.innerWidth,
                      height: window.innerHeight,
                    })}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <MenuList
                      onPick={() => setGearMenu(null)}
                      items={[
                        {
                          label: "環境設定…",
                          icon: <MenuIcon name="preferences" />,
                          onSelect: openPreferences,
                        },
                        { kind: "separator" },
                        {
                          label: "サイドバー",
                          checked: settings.treesVisible,
                          onSelect: () => menu["toggle-trees"]?.(),
                        },
                        {
                          label: "ノート一覧",
                          checked: settings.notesVisible,
                          onSelect: () => menu["toggle-notes"]?.(),
                        },
                        {
                          label: "アウトライン",
                          checked: outlineOpen,
                          onSelect: toggleOutline,
                        },
                        // 使わない設定のときは並べない（押せない項目を見せない）
                        ...(settings.assistantEnabled
                          ? [
                              {
                                label: "アシスタント",
                                checked: assistantOpen,
                                onSelect: () => menu.assistant?.(),
                              } satisfies MenuEntry,
                            ]
                          : []),
                        { kind: "separator" },
                        {
                          label: "ソース表示",
                          checked: sourceMode,
                          onSelect: () => menu["source-mode"]?.(),
                        },
                        {
                          label: "フォーカスモード",
                          checked: false,
                          onSelect: () => menu["focus-mode"]?.(),
                        },
                        {
                          label: "タイプライタモード",
                          checked: false,
                          onSelect: () => menu.typewriter?.(),
                        },
                      ]}
                    />
                  </ul>
                </div>
              );
            })()}
          {tagMenu !== null &&
            (() => {
              const target = tagMenu.tag;
              const filtered = target === tagFilter;
              return (
                <ContextMenu at={tagMenu} onClose={() => setTagMenu(null)}>
                  <MenuList
                    onPick={() => setTagMenu(null)}
                    items={[
                      {
                        label: filtered
                          ? "絞り込みを解除"
                          : `#${target} で絞り込む`,
                        onSelect: () => filterByTag(filtered ? null : target),
                      },
                      // 絞り込みは一覧を狭めるだけ。**本文まで見たいとき**は
                      // 検索へ回す（同じ書き方が検索欄でも効く）
                      {
                        label: "このタグで全ノート検索",
                        icon: <MenuIcon name="search" />,
                        onSelect: () => searchByTag(target),
                      },
                      { kind: "separator" },
                      {
                        label: "タグ名をコピー",
                        icon: <MenuIcon name="copy" />,
                        onSelect: () => void copyTag(target),
                      },
                    ]}
                  />
                </ContextMenu>
              );
            })()}
          {folderMenu !== null &&
            (() => {
              // 空文字は保管フォルダの直下（「直下」の行）。名前も変えられ
              // ないし消せないので、作る項目だけ出す
              const target = folderMenu.folder;
              const isRoot = target === "";
              return (
                <ContextMenu
                  at={folderMenu}
                  onClose={() => setFolderMenu(null)}
                >
                  <MenuList
                    onPick={() => setFolderMenu(null)}
                    items={[
                      {
                        label: "新規ノート",
                        icon: <MenuIcon name="noteNew" />,
                        onSelect: () => void handleCreate(target),
                      },
                      {
                        label: "新規フォルダ…",
                        icon: <MenuIcon name="folderNew" />,
                        onSelect: () =>
                          setFolderDialog({ kind: "create", folder: target }),
                      },
                      {
                        label: "Finder で開く",
                        icon: <MenuIcon name="finder" />,
                        onSelect: () => void openInFinder(target),
                      },
                      ...(isRoot
                        ? []
                        : ([
                            { kind: "separator" },
                            {
                              label: "名前を変更…",
                              icon: <MenuIcon name="rename" />,
                              onSelect: () =>
                                setFolderDialog({
                                  kind: "rename",
                                  folder: target,
                                }),
                            },
                            {
                              label: "削除",
                              icon: <MenuIcon name="trash" />,
                              danger: true,
                              onSelect: () => void handleDeleteFolder(target),
                            },
                          ] satisfies MenuEntry[])),
                    ]}
                  />
                </ContextMenu>
              );
            })()}
          {outlineMenu !== null && (
            <ContextMenu at={outlineMenu} onClose={() => setOutlineMenu(null)}>
              {/* 節ごと動かす（7-1。ポメラのアウトライン相当）。
                  端では押しても何も起きないので、知らせを出す */}
              <MenuList
                onPick={() => setOutlineMenu(null)}
                items={[
                  {
                    label: "この節を上へ動かす",
                    icon: <MenuIcon name="moveUp" />,
                    onSelect: () => {
                      if (
                        !editorRef.current?.moveSection(outlineMenu.from, -1)
                      ) {
                        setStatus("これより上には動かせません");
                      }
                    },
                  },
                  {
                    label: "この節を下へ動かす",
                    icon: <MenuIcon name="moveDown" />,
                    onSelect: () => {
                      if (
                        !editorRef.current?.moveSection(outlineMenu.from, 1)
                      ) {
                        setStatus("これより下には動かせません");
                      }
                    },
                  },
                ]}
              />
            </ContextMenu>
          )}
          {trashMenu !== null &&
            (() => {
              const target = trashMenu.path;
              return (
                <ContextMenu at={trashMenu} onClose={() => setTrashMenu(null)}>
                  <MenuList
                    onPick={() => setTrashMenu(null)}
                    items={[
                      {
                        label: "Finder で開く",
                        icon: <MenuIcon name="finder" />,
                        onSelect: () => void openInFinder(TRASH_FOLDER),
                      },
                      { kind: "separator" },
                      ...(target === null
                        ? ([
                            {
                              label: "ゴミ箱を空にする…",
                              icon: <MenuIcon name="trash" />,
                              danger: true,
                              onSelect: () => void handleEmptyTrash(),
                            },
                          ] satisfies MenuEntry[])
                        : ([
                            {
                              label: "元に戻す",
                              icon: <MenuIcon name="restore" />,
                              onSelect: () => void handleRestore(target),
                            },
                            { kind: "separator" },
                            {
                              label: "完全に削除",
                              icon: <MenuIcon name="trash" />,
                              danger: true,
                              onSelect: () => void handleDeleteForever(target),
                            },
                          ] satisfies MenuEntry[])),
                    ]}
                  />
                </ContextMenu>
              );
            })()}
          {styleFindings !== null && (
            <StyleCheckDialog
              findings={styleFindings}
              text={editorRef.current?.getText() ?? ""}
              onJump={(pos) => {
                setStyleFindings(null);
                editorRef.current?.revealPos(pos);
              }}
              onClose={() => setStyleFindings(null)}
            />
          )}
          {graph !== null && (
            <GraphDialog
              svg={graph.svg}
              dropped={graph.dropped}
              depth={graphDepth}
              onDepth={(depth) => void showLinkGraph(depth)}
              onClose={() => setGraph(null)}
            />
          )}
          {savingSearch !== null && (
            <PromptDialog
              title="検索を保存"
              label="サイドバーに出す名前"
              // 既定は式そのもの（短い式ならそのまま通せる）
              defaultValue={savingSearch}
              note={`検索式: ${savingSearch}`}
              confirmLabel="保存"
              onConfirm={confirmSaveSearch}
              onClose={() => setSavingSearch(null)}
            />
          )}
          {templateName !== null && (
            <PromptDialog
              title="テンプレートに登録"
              label="名前"
              defaultValue={noteStem(templateName)}
              note="見出しは {{title}} に置き換わります（この雛形から作ったノートには新しい題名が入ります）。"
              confirmLabel="登録"
              onConfirm={(typed) => void confirmRegisterTemplate(typed)}
              onClose={() => setTemplateName(null)}
            />
          )}
          {sync.deleted !== null && (
            <ChoiceDialog
              title="ファイルが削除されました"
              text={`「${noteStem(sync.deleted)}」は外部で削除されました。編集中の内容で作り直しますか？`}
              choices={[
                { label: "閉じる", onChoose: sync.closeDeleted },
                {
                  label: "作り直す",
                  onChoose: () => void sync.recreateDeleted(),
                },
              ]}
            />
          )}
          {sync.conflict !== null && (
            <ChoiceDialog
              title="このノートは外部でも変更されています。どうしますか？"
              choices={[
                {
                  label: "外部の変更を採用（自分の編集を捨てる）",
                  onChoose: () => void sync.resolveConflict("external"),
                },
                {
                  label: "自分の版で上書き（外部の変更を捨てる）",
                  onChoose: () => void sync.resolveConflict("mine"),
                },
                {
                  label: "両方残す（自分の版を「名前 (競合 日付)」に保存）",
                  onChoose: () => void sync.resolveConflict("both"),
                },
              ]}
            />
          )}
          {historyEntries !== null && (
            <HistoryDialog
              entries={historyEntries}
              onRestore={(entry) => void restoreVersion(entry)}
              onClose={() => setHistoryEntries(null)}
            />
          )}
          {assistantOpen && (
            <AssistantPane
              hasNote={currentPath !== null}
              llmReady={assistant.llmReady}
              thinking={assistant.thinking}
              answer={assistant.answer}
              question={assistant.question}
              onQuestionChange={assistant.setQuestion}
              sources={assistant.sources}
              related={assistant.related}
              relatedShown={assistant.relatedShown}
              onStop={assistant.stop}
              onRelated={assistant.showRelated}
              onAsk={(task) => void assistant.ask(task)}
              onAskQuestion={() => void assistant.askQuestion()}
              onOpen={(path) => void openNote(`${vaultRoot}/${path}`)}
            />
          )}
          {rightPane === "reference" && reference && (
            // 横に開いたノート（U-1）。**読むだけ** — 保存も監視も繋がない
            <aside className="reference-pane">
              <header>
                {/* どのノートを見ているかが分からないと参照にならない */}
                <span className="reference-title">{reference.title}</span>
                <button
                  className="reference-close"
                  title="閉じる"
                  aria-label="閉じる"
                  onClick={closeReference}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </header>
              {/* **本文と同じエディタを読み取り専用で使う**（別の描き方を
                用意すると、帯や折りたたみが 2 系統になる） */}
              <Editor
                key={reference.path}
                readOnly
                initialDoc={reference.text}
                resolveImage={(url) => imageSource(vaultRoot, url)}
                diagramTheme={diagramTheme}
                tabWidth={settings.tabWidth}
                lineNumbers={settings.lineNumbers}
                indentedCode={settings.indentedCode}
              />
            </aside>
          )}
          {outlineOpen && (
            <OutlinePane
              items={outlineItems}
              currentIndex={currentOutlineIndex}
              onJump={(from) => editorRef.current?.revealPos(from)}
              onMenu={setOutlineMenu}
            />
          )}
        </div>
        <StatusBar
          status={status}
          stats={currentPath !== null ? stats : null}
          savedAt={savedAt}
          onMenu={setGearMenu}
        />
      </main>
      {/* 印刷用（ADR-0038）。画面では隠れていて、紙にはここだけが出る。
          中身は書き出しと同じ本文（markdown-it が組んだもの） */}
      <div
        className="print-root"
        dangerouslySetInnerHTML={{ __html: printBody?.html ?? "" }}
      />
    </>
  );
}

export default App;
