import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Editor, type EditorHandle } from "./editor/Editor";
import { useAssistant } from "./hooks/useAssistant";
import { useNoteSync } from "./hooks/useNoteSync";
import { useCaptureShortcut } from "./hooks/useCaptureShortcut";
import { useSearch } from "./hooks/useSearch";
import { useMcpHidden } from "./hooks/useMcpHidden";
import { useLatest } from "./hooks/useLatest";
import { useExport } from "./hooks/useExport";
import { useOutline } from "./hooks/useOutline";
import { usePreferences } from "./hooks/usePreferences";
import { editModeChecks } from "./lib/menu-checks";
import { runWithStatus } from "./lib/run-command";
import { editModeOf, nextEditMode, type EditMode } from "./lib/edit-mode";
import {
  rememberSidePane,
  restoreSidePane,
  toggleSidePane,
  type SideKind,
} from "./lib/side-pane";
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
import {
  folderMenuItems,
  noteMenuItems,
  trashMenuItems,
} from "./components/note-menu";
import { editorMenuItems } from "./components/editor-menu";
import { gearMenuItems } from "./components/gear-menu";
import {
  newNoteMenuItems,
  outlineMenuItems,
  tagMenuItems,
} from "./components/side-menus";
import { MenuList } from "./components/MenuList";
import { NoteActions } from "./components/NoteActions";
import { NoteTitle } from "./components/NoteTitle";
import { NoteRows } from "./components/NoteRows";
import { OutlinePane } from "./components/OutlinePane";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { PromptDialog } from "./components/PromptDialog";
import { SavedSearchSection } from "./components/SavedSearchSection";
import { SearchHits } from "./components/SearchHits";
import { ReplacePanel } from "./components/ReplacePanel";
import { StatusBar } from "./components/StatusBar";
import { StyleCheckDialog } from "./components/StyleCheckDialog";

import { TableDialog } from "./components/TableDialog";
import { TagSection } from "./components/TagSection";
import { TaskSection } from "./components/TaskSection";
import { TrashRows } from "./components/TrashRows";

import { anchorAbove } from "./lib/context-menu";
import {
  confirmMessage,
  dictUrl,
  handoffUrl,
  needsConfirm,
  searchUrl,
  type Handoff,
} from "./lib/handoff";
import { finderTarget, TRASH_FOLDER } from "./lib/finder";
import { APP_NAME } from "./lib/app-name";
import { noteLabel, noteStem, nfcUnder } from "./lib/note-path";
import {
  isHiddenFromMcp,
  relativeIn,
  hiddenByAncestor,
} from "./lib/mcp-hidden";
import { firstHeading, sanitizeStem } from "./lib/note-title";
import { windowTitle } from "./lib/window-title";
import { renameStatusText } from "./lib/rename-status";
import { tagRenamePlan } from "./lib/tag-rename";
import { lineStartOffset, setTaskDone } from "./markdown/tasks";
import { sectionOf, splitEmbedTarget } from "./markdown/section";
import type { EmbedResolver } from "./editor/embed";
import { startupAction } from "./lib/startup-note";
import {
  canDropAny,
  parseNoteDrag,
  rangeSelection,
  toggleSelection,
} from "./lib/note-selection";
import {
  folderDepth,
  folderLabel,
  newNoteFolder,
  splitFolders,
} from "./lib/folder-tree";
import { dayValue } from "./lib/day";
import { folderFilterLabel, trashLabel } from "./lib/trash-label";
import { canDropInto, isFileDrag, isNoteDrag } from "./lib/note-drop";
import { fontStack } from "./lib/fonts";
import type { Activation } from "./editor/activation";
import type { OutlineItem } from "./editor/outline";
import { renderMermaid, type MermaidTheme } from "./editor/mermaid";
import {
  referenceLives,
  restoreRightPane,
  RIGHT_PANE_KEY,
  type RightPane,
  togglePane,
} from "./lib/right-pane";
import { collectEmbeds } from "./lib/export-html";
import { extractNote } from "./lib/extract";
import { buildGraph, DEFAULT_DEPTH, graphToMermaid } from "./lib/graph";
import { checkStyle, type Finding } from "./lib/style-check";
import { DEFAULT_FONT_PX, FONT_STEP_PX, zoomActionFor } from "./lib/font-size";
import {
  forgetLastNote,
  lastNoteFor,
  restoreLastVault,
  saveLastNote,
  saveLastVault,
  vaultErrorText,
} from "./lib/last-vault";
import { contentWidthCss, resolveTheme } from "./lib/settings";
import {
  createNote,
  deleteForever,
  emptyTrash,
  historyList,
  historyRead,
  historyUsage,
  llmModels,
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
  placeMcpManual,
  setMenuChecks,
  mcpConfig,
  templateList,
  pinNote,
  readNote,
  saveAttachment,
  renameNote,
  renameTag,
  subscribeVaultChanged,
  replaceApply,
  taskComplete,
  replacePreview,
  type ReplaceOptions,
  vaultIsEmpty,
  setWindowTitle,
  restoreNote,
  trashNote,
  writeNote,
  type Backlink,
  type HistoryEntry,
  confirmDialog,
  defaultVault,
  openExternalUrl,
  openHandoffApp,
  openHandoffUrl,
  openInFinder as openInFinderIpc,
  pickFile,
  pickFolder,
  readClipboardText,
  revealInFinder,
  startupElapsedMs,
  subscribeIndexUpdated,
  subscribeIndexSynced,
  subscribeIndexSyncFailed,
  subscribeMenu,
  writeClipboardText,
} from "./lib/ipc";
import { useAppStore } from "./stores/app";
import "./App.css";

// Phase 1 の骨格 UI: フォルダを開く → ノート一覧 → 編集 → 800ms 自動保存 →
// 新規・改名・ゴミ箱。3 ペイン構成・タグ・検索（spec §5.1）は後のフェーズで載せる。

/// サイドバー下段の節（開くのは 1 つ。フォルダ・タグ・やること）

function App() {
  const {
    vaultRoot,
    notes,
    tags,
    folders,
    trashNotes,
    tasks,
    currentPath,
    openVault,
    refresh,
    selectNote,
  } = useAppStore();
  const [doc, setDoc] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // Claude（MCP）に渡さないもの。真実は `.mcp-ignore`（T1 と同じ構え）で、
  // ここはその写し（読み直しと付け外しは hooks/useMcpHidden）
  const { hidden: mcpHiddenList, setHidden: setMcpHiddenFlag } =
    useMcpHidden(vaultRoot);
  const editorRef = useRef<EditorHandle>(null);
  // メニューのハンドラは一度だけ登録するので、最新値は ref で読む
  const vaultRootRef = useLatest(vaultRoot);
  const currentPathRef = useLatest(currentPath);
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
  const queryRef = useLatest(query);
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

  // 環境設定・文字サイズ・PowerPoint の設定（19-4 で hooks/usePreferences に）
  const {
    settings,
    settingsRef,
    changeSettings,
    resetPreferences,
    startResize,
    fontSize,
    changeFontSize,
    pptxSettings,
    changePptxSettings,
    resetPptxSettings,
  } = usePreferences();
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
  }, [vaultRootRef]); // ref は不変。lint が useLatest を ref と知らないので並べる

  /// Ollama に入っているモデル名（設定のモデル欄の選択肢）
  const loadInstalledModels = useCallback(
    (): Promise<string[]> => llmModels(settingsRef.current.llmPort),
    [settingsRef],
  );

  /// 左のペインは、中身が 1 つも無ければ畳む（空の帯を残さない）
  const leftVisible = settings.notesVisible || settings.treesVisible;

  const fontSizeRef = useLatest(fontSize);

  // 一覧の右クリックメニュー（ui/note_actions.py の役目）
  // 掴んでいるノートのパス。**ref で持つ** — dragover は毎フレーム飛ぶので、
  // 掴んだものまで state にすると打鍵と同じだけ再描画が走る
  // 掴んでいるノート（複数選択ならその全部。要望 2026-09-10）
  const draggingNotes = useRef<string[]>([]);
  // 一覧の複数選択。開いているノートとは別の集合（lib/note-selection）
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  // 横に開いたノート（U-1）。**読むだけ**なので、保存も監視も繋がない
  const [reference, setReference] = useState<{
    path: string;
    title: string;
    text: string;
  } | null>(null);
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

  /// 「Claude に渡さない」の付け外し（ピン留めと同じ手触り）。
  /// **フォルダでもノートでも同じ道**（`.mcp-ignore` に 1 行増える・減る）
  async function toggleMcpHidden(path: string) {
    if (!vaultRoot) return;
    const relative = relativeIn(vaultRoot, path);
    if (!relative) return;
    // 親フォルダごと隠れているなら、自分の 1 行を消しても何も変わらない。
    // 「渡します」と言って渡らないのが最悪なので、ここでも断る
    const ancestor = hiddenByAncestor(mcpHiddenList, relative);
    if (ancestor) {
      setStatus(`「${ancestor}」ごと隠れています。そちらで切り替えてください`);
      return;
    }
    const hidden = isHiddenFromMcp(mcpHiddenList, relative);
    try {
      await setMcpHiddenFlag(relative, !hidden);
      setStatus(
        hidden
          ? `「${relative}」を Claude に渡します`
          : `「${relative}」は Claude に渡しません`,
      );
    } catch (error) {
      setStatus(`変えられませんでした: ${String(error)}`);
    }
  }

  /// MCP の設定（Claude Desktop 用の JSON 断片）をクリップボードへ（10-6）。
  /// **パスを手で打たせない** — 束ねた `.app` の中のバイナリの場所も、
  /// 保管フォルダの場所も、アプリ側が知っている
  async function copyMcpConfig(): Promise<boolean> {
    if (!vaultRoot) return false;
    try {
      const snippet = await mcpConfig(vaultRoot);
      await writeClipboardText(snippet);
      setStatus(
        "MCP の設定をコピーしました（Claude Desktop の設定に貼って開き直してください）",
      );
      return true;
    } catch (error) {
      // 画面下の知らせは環境設定の裏に隠れる。**閉じたあとに残る**ぶんは
      // ここで、**その場で見えるぶん**は MCP タブが出す
      setStatus(`コピーできませんでした: ${String(error)}`);
      return false;
    }
  }

  /// `[[名前]]` の形でクリップボードへ（別のノートから指すときに打ち直さない）。
  /// **知らせを出す** — クリップボードは目に見えないので、入ったか分からない。
  async function copyNoteLink(path: string) {
    const link = `[[${noteStem(path)}]]`;
    try {
      await writeClipboardText(link);
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

  /// 開いているノートの本文を返す。環境設定の PowerPoint タブが「このノート」
  /// の下絵と収まり具合の見直し（GR-05）に使う。開いていなければ null。
  /// **currentPath ごとに 1 つ**にして、打鍵のたびに測り直させない
  const noteText = useMemo(
    () => (currentPath ? () => editorRef.current?.getText() ?? "" : null),
    [currentPath],
  );

  // 「直下」は行ではなく見出しに出す（要望 2026-09-05）
  const { root: rootNotes, sub: subFolders } = splitFolders(folders);

  // 左下のフォルダ / タグは排他で開く（ユーザー要望 2026-09-04）。
  // 両方開くと一覧が痩せすぎる。開いた側が縦の約 1/3 を使う
  const [sideOpen, setSideOpen] = useState<SideKind | null>(() =>
    restoreSidePane(localStorage),
  );
  function toggleSide(kind: SideKind) {
    setSideOpen((current) => {
      const next = toggleSidePane(current, kind);
      rememberSidePane(localStorage, next);
      return next;
    });
  }

  // クイックオープン（Cmd+O、spec §5.4）
  const [quickOpen, setQuickOpen] = useState(false);

  // 表の挿入（TASKS 2-6）。行 × 列を聞いてから差し込む
  const [tableDialog, setTableDialog] = useState(false);
  // テンプレートの選択（E-4）。null は閉じている
  const [templates, setTemplates] = useState<string[] | null>(null);
  // フォルダの作成・改名の入力（ADR-0024）。null は閉じている
  // タグの改名・統合（ADR-0055 / 12-4）。右クリックの「名前を変更…」から
  const [tagDialog, setTagDialog] = useState<string | null>(null);
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
  // 差分の「今の本文」（開いた時点で書き切ったもの。ADR-0054）
  const [historyBase, setHistoryBase] = useState("");

  async function openHistory() {
    if (!vaultRoot || !currentPath) return;
    await sync.flush(); // 未保存分を書き切ってから一覧を出す
    try {
      setHistoryBase(editorRef.current?.getText() ?? "");
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
    const ok = await confirmDialog(
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
  // 目次と統計（19-4 で hooks/useOutline に）。本文は EditorView から読む
  const outline = useOutline({
    open: outlineOpen,
    doc,
    currentPath,
    getOutline: () => editorRef.current?.getOutline() ?? [],
    getStats: () =>
      editorRef.current?.getStats() ?? { characters: 0, lines: 0 },
  });
  // 目次の右クリック（7-1）。節ごと動かす
  const [outlineMenu, setOutlineMenu] = useState<{
    from: number;
    x: number;
    y: number;
  } | null>(null);

  function toggleOutline() {
    const next = togglePane(rightPane, "outline");
    setRightPane(next);
    try {
      localStorage.setItem(RIGHT_PANE_KEY, next === "outline" ? "1" : "0");
    } catch {
      // 保存できなくても開閉自体は生かす
    }
  }

  async function chooseVault() {
    const picked = await pickFolder();
    if (typeof picked !== "string") return;
    await sync.flush(); // 前の vault の未保存分を書き切ってから移る
    try {
      await openVault(picked, settingsRef.current.trashDays);
    } catch (error) {
      // 二重起動の断りも含めて、開けない理由をそのまま見せる
      setStatus(vaultErrorText(error));
      return;
    }
    // 選び直した vault は索引を**作り直す**（要望 2026-09-10）。よそで使って
    // いた・古いアプリで開いていた vault の索引は疑わしい。背景で走り、
    // 終わると index-synced が知らせて一覧を引き直す
    void syncIndex(picked, true);
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
  // プレビューモード（ADR-0065）。持ち主はエディタで、ここはその写し
  const [wysiwygMode, setWysiwygMode] = useState(false);
  // 見え方の今（メニューと歯車の印に使う。要望 2026-09-13）。**持ち主は
  // エディタ**で、ここはその写し
  const [editorModes, setEditorModes] = useState({
    focus: false,
    typewriter: false,
  });

  // 図の見た目（ADR-0021）。新しく開くノートにも渡す
  const [diagramTheme, setDiagramTheme] = useState<MermaidTheme>("light");

  // 書き出し・印刷・取り込み（19-4 で hooks/useExport に切り出した）
  const {
    printBody,
    discardPrintBody,
    handlePrint,
    handleExport,
    handleExportDocx,
    handleExportPptx,
    handleImport,
  } = useExport({
    vaultRoot,
    currentPath,
    settings,
    pptxSettings,
    diagramTheme,
    flush: sync.flush,
    resolveEmbeds,
    onStatus: setStatus,
    refreshLists: refresh,
    openNote,
  });

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
  //
  // 空の vault では**ディスクを見てから**「無題」を作る（要望 2026-09-10。
  // 判断は lib/startup-note）
  const openedFirstFor = useRef<string | null>(null);
  // ディスクにノートが無いか（一覧が空のときだけ聞く。vault ごと）
  const [emptyOnDisk, setEmptyOnDisk] = useState<{
    root: string;
    empty: boolean;
  } | null>(null);
  useEffect(() => {
    if (!vaultRoot || currentPath) return;
    if (openedFirstFor.current === vaultRoot) return;
    const action = startupAction({
      remembered: lastNoteFor(localStorage, vaultRoot),
      notes,
      sorted: sortedNotes,
      emptyOnDisk: emptyOnDisk?.root === vaultRoot ? emptyOnDisk.empty : null,
    });
    if (action.kind === "wait") return; // 索引が育つ（index-updated）のを待つ
    if (action.kind === "ask-disk") {
      const root = vaultRoot;
      vaultIsEmpty(root)
        .then((empty) => setEmptyOnDisk({ root, empty }))
        .catch(() => {});
      return;
    }
    openedFirstFor.current = vaultRoot;
    if (action.kind === "create") {
      void handleCreate("");
      return;
    }
    if (action.forget) forgetLastNote(localStorage);
    void openNote(action.path);
    // openNote / handleCreate は毎描画で作り直されるが、開くかどうかは
    // 上の条件で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultRoot, currentPath, notes, sortedNotes, emptyOnDisk]);

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
        const fallback = await defaultVault();
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
    discardPrintBody(); // 前のノートの印刷用の組みは捨てる（ADR-0038）
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

  /// MCP（Claude とつなぐ）の手引きを置いて開く。初回には置かないので、
  /// 繋ぎたくなった人がここから出す
  async function handlePlaceMcpManual() {
    if (!vaultRoot) return;
    const placed = await placeMcpManual(vaultRoot);
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

  /// タグの改名・統合（ADR-0055 / 12-4）。統合なら確認を 1 回挟む。開いて
  /// いるノートは先に書き切り、対象だったら読み直す
  async function confirmTagName(typed: string) {
    const from = tagDialog;
    setTagDialog(null);
    if (!vaultRoot || !from) return;
    const plan = tagRenamePlan(
      tags.map((entry) => entry.tag),
      from,
      typed,
    );
    if (plan.kind === "same") return;
    if (plan.kind === "invalid") {
      setStatus("タグの名前に空白と # は使えません");
      return;
    }
    if (plan.kind === "merge") {
      const ok = await confirmDialog(
        `「#${from}」を「#${plan.to}」に統合しますか？\n（全ノートの #${from} が #${plan.to} になります）`,
        { title: APP_NAME, kind: "warning" },
      );
      if (!ok) return;
    }
    await sync.flush();
    try {
      const outcome = await renameTag(vaultRoot, from, plan.to);
      if (currentPath && outcome.paths.includes(currentPath)) {
        const text = await readNote(vaultRoot, currentPath);
        sync.adopt(text);
      }
      if (tagFilter === from) filterByTag(plan.to.toLowerCase());
      await refresh();
      const head =
        plan.kind === "merge"
          ? `「#${from}」を「#${plan.to}」に統合しました（${outcome.notes} 件のノート）`
          : `「#${from}」を「#${plan.to}」にしました（${outcome.notes} 件のノート）`;
      setStatus(
        outcome.failed.length
          ? `${head}（書けなかった: ${outcome.failed.join("、")}）`
          : head,
      );
    } catch (error) {
      setStatus(`タグの改名に失敗: ${String(error)}`);
    }
  }

  /// やること一覧から、そのノートのその行へ（ADR-0056）。行番号は 0 始まり
  async function openTask(relative: string, line: number) {
    if (!vaultRoot) return;
    const path = `${vaultRoot}/${relative}`;
    try {
      const text = await readNote(vaultRoot, path);
      await openNote(path, lineStartOffset(text, line) ?? 0);
    } catch (error) {
      setStatus(`開けませんでした: ${String(error)}`);
    }
  }

  /// やること一覧の箱を押した: 完了にする。開いているノートならエディタで
  /// 書く（自動保存が走る）。閉じているノートは Rust が書き、索引を更新する
  async function completeTask(relative: string, line: number) {
    if (!vaultRoot) return;
    const path = `${vaultRoot}/${relative}`;
    if (path === currentPath && editorRef.current) {
      const edit = setTaskDone(editorRef.current.getText(), line, true);
      if (edit) editorRef.current.replaceRange(edit.from, edit.to, edit.insert);
      // 一覧は保存のあとの索引更新で消える。待たずに手元で消す
      await sync.flush();
      await refresh();
      return;
    }
    try {
      await taskComplete(vaultRoot, path, line);
      await refresh();
    } catch (error) {
      setStatus(`完了にできませんでした: ${String(error)}`);
    }
  }

  /// 埋め込み `![[名前]]` の解決（ADR-0058）。名前はノートの題名（ファイル名の
  /// 幹）で、`[[…]]` を開くときと同じ規則。見張りは vault-changed をパスで絞る
  const embedResolverForEditor: EmbedResolver = {
    resolve: async (name) => {
      if (!vaultRoot) return null;
      const wanted = name.toLowerCase();
      const entry = useAppStore
        .getState()
        .notes.find((note) => noteStem(note.path).toLowerCase() === wanted);
      if (!entry) return null;
      try {
        return {
          path: entry.path,
          text: await readNote(vaultRoot, entry.path),
        };
      } catch {
        return null;
      }
    },
    open: (path) => void openNote(path),
    watch: (path, onChange) =>
      subscribeVaultChanged((change) => {
        if (change.path === path) onChange();
      }),
  };

  /// 書き出し・印刷の前に埋め込みの中身を集める（HTML / PDF は展開する。
  /// 読む側に元のノートは無い）。深さは 1
  async function resolveEmbeds(text: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const target of collectEmbeds(text)) {
      const { name, heading } = splitEmbedTarget(target);
      const source = await embedResolverForEditor.resolve(name);
      if (!source) continue;
      const body = heading ? sectionOf(source.text, heading) : source.text;
      if (body !== null) found.set(target, body);
    }
    return found;
  }

  /// 保管フォルダ全体の置換（ADR-0055 / 12-3）。開いているノートは先に書き
  /// 切り、置換の対象だったら読み直して本文を差し替える（Rust は書いた
  /// ノートを監視から抑制しているので、ここで自分で追いかける）
  async function handleReplaceAll(to: string, options: ReplaceOptions) {
    if (!vaultRoot) return;
    const from = query;
    const ok = await confirmDialog(
      `「${from}」を「${to}」に置き換えます。元には戻せません（各ノートの履歴には残ります）。続けますか？`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await sync.flush();
    try {
      const outcome = await replaceApply(vaultRoot, from, to, options);
      if (currentPath && outcome.paths.includes(currentPath)) {
        const text = await readNote(vaultRoot, currentPath);
        sync.adopt(text);
        headingRef.current = firstHeading(text);
      }
      await refresh();
      const head = `${outcome.notes} 件のノート・${outcome.occurrences} 箇所を置換しました`;
      setStatus(
        outcome.failed.length
          ? `${head}（書けなかった: ${outcome.failed.join("、")}）`
          : head,
      );
    } catch (error) {
      setStatus(`置換に失敗: ${String(error)}`);
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
    const ok = await confirmDialog(`フォルダ「${folder}」を削除しますか？`, {
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
    const dragged = draggingNotes.current;
    if (dragged.length > 0) return canDropAny(vaultRoot ?? "", dragged, folder);
    return isNoteDrag(Array.from(event.dataTransfer.types));
  }

  /// フォルダの行へ落とされたノートを移す（要望 2026-09-04）。
  ///
  /// **メニューの「フォルダへ移動…」と同じ道を通す**（`moveNote`）。
  /// 落としたのが開いているノートなら、動いた先を開き直す。
  async function handleDropOnFolder(paths: string[], folder: string) {
    if (!vaultRoot) return;
    const moving = paths.filter((path) => canDropInto(vaultRoot, path, folder));
    if (moving.length === 0) return;
    const open = currentPath !== null && moving.includes(currentPath);
    if (open) await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    let movedOpen: string | null = null;
    const failed: string[] = [];
    for (const path of moving) {
      try {
        const moved = await moveNote(vaultRoot, path, folder);
        if (path === currentPath) movedOpen = moved;
      } catch (error) {
        failed.push(`${noteStem(path)}: ${String(error)}`);
      }
    }
    await refresh();
    setSelectedNotes(new Set());
    if (movedOpen) await openNote(movedOpen);
    const where = folder ? `「${folder}」` : "直下";
    const done =
      moving.length - failed.length === 1 && failed.length === 0
        ? `「${noteStem(moving[0])}」を${where}へ移しました`
        : `${moving.length - failed.length} 件を${where}へ移しました`;
    setStatus(
      failed.length ? `${done}（移せなかった: ${failed.join("、")}）` : done,
    );
  }

  /// 複数のノートをまとめてゴミ箱へ（一覧の複数選択をゴミ箱へ落とした）。
  /// 確認は 1 回。ピン留めは外して知らせる（spec §7.3）
  async function handleTrashMany(paths: string[]) {
    if (!vaultRoot) return;
    if (paths.length === 1) {
      await handleTrash(paths[0]);
      return;
    }
    const pinned = paths.filter(
      (path) => notes.find((entry) => entry.path === path)?.pinned,
    );
    const targets = paths.filter((path) => !pinned.includes(path));
    if (targets.length === 0) {
      setStatus("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirmDialog(
      `${targets.length} 件のノートをゴミ箱へ移しますか？` +
        (pinned.length ? `（ピン留め中の ${pinned.length} 件は残します）` : ""),
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    if (currentPath !== null && targets.includes(currentPath)) {
      sync.dropPending();
    }
    const failed: string[] = [];
    for (const path of targets) {
      try {
        await trashNote(vaultRoot, path);
      } catch (error) {
        failed.push(`${noteStem(path)}: ${String(error)}`);
      }
    }
    await refresh();
    setSelectedNotes(new Set());
    if (currentPath !== null && targets.includes(currentPath)) {
      selectNote(null);
      setDoc(null);
      forgetLastNote(localStorage);
    }
    setStatus(
      failed.length
        ? `${targets.length - failed.length} 件をゴミ箱へ移しました（移せなかった: ${failed.join("、")}）`
        : `${targets.length} 件をゴミ箱へ移しました`,
    );
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
  // どこからでも書き取り（ADR-0057）。設定のショートカットを OS に登録する
  const captureShortcut = useCaptureShortcut(settings.captureShortcut);

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
      const outcome = await renameNote(vaultRoot, currentPath, trimmed);
      const renamed = outcome.path;
      await refresh();
      const text = await readNote(vaultRoot, renamed);
      selectNote(renamed);
      saveLastNote(localStorage, vaultRoot, renamed);
      setDoc(text); // Rust が本文の見出しも書き換えている（ADR-0005）
      sync.markOpened({ path: renamed, text });
      headingRef.current = firstHeading(text);
      setStatus(renameStatusText(outcome));
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
      const outcome = await renameNote(vaultRoot, currentPath, heading);
      const renamed = outcome.path;
      if (renamed === currentPath) return;
      setStatus(renameStatusText(outcome));
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
  const followHeadingRef = useLatest(followHeading);
  useEffect(() => {
    if (savedAt === null) return;
    void followHeadingRef.current();
  }, [savedAt, followHeadingRef]);

  async function handleTrash(target?: string) {
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    // ピン留め中は削除ガード（spec §7.3）。Rust 側も拒むが、確認を
    // 出す前にここで止めるほうが親切
    if (notes.find((entry) => entry.path === path)?.pinned) {
      setStatus("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirmDialog(
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

  /// PowerPoint のテンプレートを選ぶ（TASKS 5-6）。
  /// **場所を覚えるだけ** — 中身は書き出すときに読む（選んだあとに
  /// 差し替えられても、そのときの中身が使われる）。
  async function chooseSlideTemplate() {
    const picked = await pickFile({
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
      await openInFinderIpc(root, finderTarget(root, folder));
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
      await openHandoffUrl(url);
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
      const ok = await confirmDialog(confirmMessage(handoff, selected), {
        title: APP_NAME,
        kind: "warning",
      });
      if (!ok) return;
    }
    try {
      if (handoff.search) {
        await openExternalUrl(searchUrl(selected));
        return;
      }
      // 文字ごと渡せるアプリには直接渡す（貼り付けが要らない）。
      // 渡せないアプリと、URL に載せきれない長さは**クリップボードに倒す**
      const direct = handoffUrl(handoff, selected);
      if (direct) {
        await openHandoffUrl(direct);
        setStatus(`${handoff.app} に渡しました`);
        return;
      }
      await writeClipboardText(selected);
      await openHandoffApp(handoff.app ?? "");
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
        const text = await readClipboardText();
        if (text) editor.replaceSelection(text);
        return;
      }
      const selected = editor.getSelection();
      if (!selected) return;
      await writeClipboardText(selected);
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
      await writeClipboardText(`#${tag}`);
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
      void openExternalUrl(action.payload);
      return;
    }
    if (action.kind === "tag") {
      filterByTag(action.payload);
      return;
    }
    // 名前は NFC で来る（wikilinkTarget）。題名側も寄せて比べる — macOS の
    // ファイル名は分解形で来ることがある
    const wanted = action.payload.toLowerCase();
    const target = useAppStore
      .getState()
      .notes.find(
        (entry) =>
          noteStem(entry.path).normalize("NFC").toLowerCase() === wanted,
      );
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
    const ok = await confirmDialog(
      `「${trashLabel(vaultRoot, path)}」を完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await deleteForever(vaultRoot, path);
    await refresh();
  }

  async function handleEmptyTrash() {
    if (!vaultRoot) return;
    const ok = await confirmDialog(
      `ゴミ箱の ${trashNotes.length} 件をすべて完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await emptyTrash(vaultRoot);
    await refresh();
  }

  function handleDocChanged(getText: () => string) {
    sync.noteChanged(getText);
    outline.docChanged();
  }

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

  // メニューの印（✓）を今の状態に合わせる（要望 2026-09-13）。**状態を持つ
  // のは画面**（T2）で、Rust は言われたとおりに付け外しするだけ。変わるたびに
  // 全部まとめて送る — 1 つずつ送ると、どれかを送り忘れたときに気付けない
  useEffect(() => {
    void setMenuChecks({
      "toggle-trees": settings.treesVisible,
      "toggle-notes": settings.notesVisible,
      outline: outlineOpen,
      assistant: assistantOpen,
      ...editModeChecks({ source: sourceMode, preview: wysiwygMode }),
      "focus-mode": editorModes.focus,
      typewriter: editorModes.typewriter,
    }).catch(() => {
      // メニューの印が付かないだけ。書けなくなるわけではない
    });
  }, [
    settings.treesVisible,
    settings.notesVisible,
    outlineOpen,
    assistantOpen,
    sourceMode,
    wysiwygMode,
    editorModes.focus,
    editorModes.typewriter,
  ]);

  // ネイティブメニュー（Rust 側 build_menu）からのイベント。
  // ハンドラは一度だけ登録し、最新の動作は ref 経由で読む
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    "new-note": () => void handleCreate(),
    "new-from-template": () =>
      void runWithStatus(setStatus, "雛形の一覧", () => chooseTemplate()),
    "daily-note": () => void handleDailyNote(),
    "pick-day": openDayDialog,
    "move-note": () => {
      if (currentPathRef.current) setMoveOpen(true);
    },
    "place-manual": () => void handlePlaceManual(),
    "place-mcp-manual": () => void handlePlaceMcpManual(),
    preferences: openPreferences,
    "open-vault": () => void chooseVault(),
    resync: () =>
      void runWithStatus(setStatus, "同期", () => handleSync(false)),
    "rebuild-index": () =>
      void runWithStatus(setStatus, "同期", () => handleSync(true)),
    "cleanup-attachments": () =>
      void runWithStatus(setStatus, "添付の片づけ", () =>
        handleCleanupAttachments(),
      ),
    save: () => sync.flush(),
    "export-html": () =>
      void runWithStatus(setStatus, "HTML の書き出し", () => handleExport()),
    "export-pptx": () =>
      void runWithStatus(setStatus, "PowerPoint の書き出し", () =>
        handleExportPptx(),
      ),
    "export-docx": () =>
      void runWithStatus(setStatus, "Word の書き出し", () =>
        handleExportDocx(),
      ),
    "export-pdf": () => void handlePrint(true),
    "import-pdf": () => void handleImport("pdf"),
    "import-pptx": () => void handleImport("pptx"),
    "import-image": () => void handleImport("image"),
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
    // 編集モード（要望 2026-09-15）。上 3 つは排他: インラインは「両方切」、
    // ソースとプレビューは押すと入り、もう一度押すとインラインへ戻る
    // （`Cmd+/` を今までどおり行き帰りに使えるように、選ぶだけの radio に
    // はしない）
    "inline-mode": () => applyEditMode("inline"),
    "source-mode": () => editorRef.current?.toggleSourceMode(),
    "preview-mode": () => editorRef.current?.toggleWysiwygMode(),
    "focus-mode": () => editorRef.current?.toggleFocusMode(),
    typewriter: () => editorRef.current?.toggleTypewriterMode(),
  };
  /// 一覧を引き直し、できなければステータスに出す（3 か所にあった同じ catch を 1 つに）
  function refreshOrStatus(): Promise<void> {
    return useAppStore
      .getState()
      .refresh()
      .catch((error) =>
        setStatus(`一覧を更新できませんでした: ${String(error)}`),
      );
  }

  /// 編集モードを指定して入る（メニューの「インラインモード」と右上のボタン）。
  /// ソースとプレビューの排他は field 側が持つので、入れたいほうを立てるだけ
  function applyEditMode(mode: EditMode) {
    const editor = editorRef.current;
    if (!editor) return;
    if (mode === "inline") {
      editor.setSourceMode(false);
      editor.setWysiwygMode(false);
    } else if (mode === "source") {
      editor.setSourceMode(true);
    } else {
      editor.setWysiwygMode(true);
    }
  }
  useEffect(() => {
    return subscribeMenu((id) => menuActions.current[id]?.());
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
    const ok = await confirmDialog(
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
    const unlisten = subscribeIndexSynced((full, result) => {
      {
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
        void refreshOrStatus();
      }
    });
    return unlisten;
  }, []);

  useEffect(() => {
    return subscribeIndexSyncFailed((message) =>
      setStatus(`索引の同期に失敗しました: ${message}`),
    );
  }, []);

  // 背景の索引同期が終わったら一覧を引き直す（大きな vault の初回同期）
  useEffect(() => {
    return subscribeIndexUpdated(() => void refreshOrStatus());
  }, []);

  // 起動時間の実測（spec §6.6）。ベンチ時は Rust 側が印字して終了する
  useEffect(() => {
    startupElapsedMs()
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
            draggingNotes.current = [];
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
                <>
                  <SearchHits
                    hits={hits}
                    onOpen={(path) => void openNote(`${vaultRoot}/${path}`)}
                  />
                  {/* 保管フォルダ全体の置換（ADR-0055）。検索欄の字を置き換える */}
                  <ReplacePanel
                    key={query}
                    query={query}
                    onPreview={(options) =>
                      replacePreview(vaultRoot, query, options)
                    }
                    onApply={(to, options) => handleReplaceAll(to, options)}
                  />
                </>
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
                      onOpen={(path) => {
                        setSelectedNotes(new Set([path]));
                        void openNote(path);
                      }}
                      onMenu={setNoteMenu}
                      onDragStart={(paths) => {
                        draggingNotes.current = paths;
                      }}
                      onDragEnd={() => {
                        draggingNotes.current = [];
                      }}
                      selected={selectedNotes}
                      onToggleSelect={(path) =>
                        setSelectedNotes((current) =>
                          toggleSelection(current, path),
                        )
                      }
                      onRangeSelect={(path) =>
                        setSelectedNotes(
                          rangeSelection(
                            sortedNotes.map((entry) => entry.path),
                            currentPath,
                            path,
                          ),
                        )
                      }
                      isHiddenFromMcp={(path) =>
                        isHiddenFromMcp(
                          mcpHiddenList,
                          relativeIn(vaultRoot ?? "", path),
                        )
                      }
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
                    const dragged = draggingNotes.current.length
                      ? draggingNotes.current
                      : parseNoteDrag(carried);
                    draggingNotes.current = [];
                    if (dragged.length)
                      void handleDropOnFolder(dragged, folder);
                  }}
                  onDropTrash={(carried) => {
                    const dragged = draggingNotes.current.length
                      ? draggingNotes.current
                      : parseNoteDrag(carried);
                    draggingNotes.current = [];
                    // ピン留めの断りと確認は handleTrash / handleTrashMany が持つ
                    if (dragged.length) void handleTrashMany(dragged);
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
              {settings.treesVisible && (
                <TaskSection
                  tasks={tasks}
                  open={sideOpen === "tasks"}
                  onToggle={() => toggleSide("tasks")}
                  onOpen={(path, line) => void openTask(path, line)}
                  onComplete={(path, line) => void completeTask(path, line)}
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
                    ピン → 書き出し → 履歴 → ゴミ箱 → 編集モード（3 つを巡る） */}
                  <NoteActions
                    pinned={
                      notes.find((entry) => entry.path === currentPath)
                        ?.pinned ?? false
                    }
                    editMode={editModeOf({
                      source: sourceMode,
                      preview: wysiwygMode,
                    })}
                    onPin={() => void handlePin()}
                    onExport={() =>
                      void runWithStatus(setStatus, "HTML の書き出し", () =>
                        handleExport(),
                      )
                    }
                    onHistory={() => void openHistory()}
                    onTrash={() => void handleTrash()}
                    onCycleMode={() =>
                      applyEditMode(
                        nextEditMode(
                          editModeOf({
                            source: sourceMode,
                            preview: wysiwygMode,
                          }),
                        ),
                      )
                    }
                  />
                </div>
                <FormatToolbar
                  onFormat={(kind) => editorRef.current?.applyFormat(kind)}
                  onColor={(hex) => editorRef.current?.applyColor(hex)}
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
                  resolveEmbed={embedResolverForEditor}
                  onCodeCopied={(ok) =>
                    setStatus(
                      ok
                        ? "コードをコピーしました"
                        : "コードをコピーできませんでした",
                    )
                  }
                  onCursorChanged={outline.cursorMoved}
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
                  wysiwyg={wysiwygMode}
                  focusMode={editorModes.focus}
                  typewriter={editorModes.typewriter}
                  onModesChanged={(modes) => {
                    setSourceMode(modes.source);
                    setWysiwygMode(modes.wysiwyg);
                    setEditorModes({
                      focus: modes.focus,
                      typewriter: modes.typewriter,
                    });
                  }}
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
                void runWithStatus(setStatus, "雛形からの作成", () =>
                  handleCreateFromTemplate(templates[index]),
                )
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
          {tagDialog !== null && (
            <PromptDialog
              title={`タグ「#${tagDialog}」の名前を変更`}
              label="新しい名前"
              defaultValue={tagDialog}
              note="全ノートの本文の #タグ を書き換えます。既にある名前にすると、そのタグに統合されます。"
              confirmLabel="決定"
              onConfirm={(typed) => void confirmTagName(typed)}
              onClose={() => setTagDialog(null)}
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
              onCopyMcpConfig={copyMcpConfig}
              onChooseSlideTemplate={() => void chooseSlideTemplate()}
              pptxSettings={pptxSettings}
              onChangePptxSettings={changePptxSettings}
              onResetPptxSettings={resetPptxSettings}
              onReset={resetPreferences}
              onClose={() => setPreferences(false)}
              noteText={noteText}
              historyUsage={loadHistoryUsage}
              installedModels={loadInstalledModels}
              captureShortcutError={captureShortcut.error}
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
                items={newNoteMenuItems({
                  onTemplate: () =>
                    void runWithStatus(setStatus, "雛形の一覧", () =>
                      chooseTemplate(),
                    ),
                  onDaily: () => void handleDailyNote(),
                })}
              />
            </ContextMenu>
          )}
          {noteMenu !== null &&
            (() => {
              const target = noteMenu.path;
              return (
                <ContextMenu at={noteMenu} onClose={() => setNoteMenu(null)}>
                  <MenuList
                    onPick={() => setNoteMenu(null)}
                    items={noteMenuItems(
                      {
                        path: target,
                        pinned:
                          notes.find((entry) => entry.path === target)
                            ?.pinned ?? false,
                        hiddenFromMcp: isHiddenFromMcp(
                          mcpHiddenList,
                          relativeIn(vaultRoot ?? "", target),
                        ),
                        hiddenBy: hiddenByAncestor(
                          mcpHiddenList,
                          relativeIn(vaultRoot ?? "", target),
                        ),
                      },
                      {
                        onPin: (path) => void handlePin(path),
                        onToggleMcpHidden: (path) => void toggleMcpHidden(path),
                        onOpenBeside: (path) => void openBeside(path),
                        onDuplicate: (path) => void handleDuplicate(path),
                        onMove: (path) => {
                          setMoveTarget(path);
                          setMoveOpen(true);
                        },
                        onSaveTemplate: (path) => setTemplateName(path),
                        onCopyLink: (path) => void copyNoteLink(path),
                        onReveal: (path) => void revealInFinder(path),
                        onTrash: (path) => void handleTrash(path),
                      },
                    )}
                  />
                </ContextMenu>
              );
            })()}
          {editorMenu !== null &&
            (() => {
              return (
                <ContextMenu
                  at={editorMenu}
                  onClose={() => setEditorMenu(null)}
                >
                  <MenuList
                    onPick={() => setEditorMenu(null)}
                    items={editorMenuItems(
                      { selected: editorMenu.selected },
                      {
                        onClipboard: (action) => void editorClipboard(action),
                        onFormat: (kind) =>
                          editorRef.current?.applyFormat(kind),
                        onInsertTable: () => setTableDialog(true),
                        onHandOff: (handoff) => void handOff(handoff),
                        onDictionary: () => void lookUpInDictionary(),
                      },
                    )}
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
                      items={gearMenuItems(
                        {
                          treesVisible: settings.treesVisible,
                          notesVisible: settings.notesVisible,
                          outlineOpen,
                          assistantEnabled: settings.assistantEnabled,
                          assistantOpen,
                          sourceMode,
                          wysiwygMode,
                          focus: editorModes.focus,
                          typewriter: editorModes.typewriter,
                        },
                        {
                          onPreferences: openPreferences,
                          onToggleTrees: () => menu["toggle-trees"]?.(),
                          onToggleNotes: () => menu["toggle-notes"]?.(),
                          onToggleOutline: toggleOutline,
                          onToggleAssistant: () => menu.assistant?.(),
                          onInlineMode: () => menu["inline-mode"]?.(),
                          onSourceMode: () => menu["source-mode"]?.(),
                          onPreviewMode: () => menu["preview-mode"]?.(),
                          onFocusMode: () => menu["focus-mode"]?.(),
                          onTypewriter: () => menu.typewriter?.(),
                        },
                      )}
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
                    items={tagMenuItems(
                      { tag: target, filtered },
                      {
                        onFilter: filterByTag,
                        onSearch: searchByTag,
                        onCopy: (tag) => void copyTag(tag),
                        onRename: setTagDialog,
                      },
                    )}
                  />
                </ContextMenu>
              );
            })()}
          {folderMenu !== null &&
            (() => {
              const target = folderMenu.folder;
              return (
                <ContextMenu
                  at={folderMenu}
                  onClose={() => setFolderMenu(null)}
                >
                  <MenuList
                    onPick={() => setFolderMenu(null)}
                    items={folderMenuItems(
                      {
                        folder: target,
                        hiddenFromMcp: isHiddenFromMcp(mcpHiddenList, target),
                        hiddenBy: hiddenByAncestor(mcpHiddenList, target),
                      },
                      {
                        onNewNote: (folder) => void handleCreate(folder),
                        onNewFolder: (folder) =>
                          setFolderDialog({ kind: "create", folder }),
                        onReveal: (folder) => void openInFinder(folder),
                        onToggleMcpHidden: (folder) =>
                          void toggleMcpHidden(folder),
                        onRename: (folder) =>
                          setFolderDialog({ kind: "rename", folder }),
                        onDelete: (folder) => void handleDeleteFolder(folder),
                      },
                    )}
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
                items={outlineMenuItems({
                  onMove: (delta) => {
                    if (
                      !editorRef.current?.moveSection(outlineMenu.from, delta)
                    ) {
                      setStatus(
                        delta < 0
                          ? "これより上には動かせません"
                          : "これより下には動かせません",
                      );
                    }
                  },
                })}
              />
            </ContextMenu>
          )}
          {trashMenu !== null && (
            <ContextMenu at={trashMenu} onClose={() => setTrashMenu(null)}>
              <MenuList
                onPick={() => setTrashMenu(null)}
                items={trashMenuItems(trashMenu.path, {
                  onReveal: () => void openInFinder(TRASH_FOLDER),
                  onEmpty: () =>
                    void runWithStatus(setStatus, "ゴミ箱を空にする", () =>
                      handleEmptyTrash(),
                    ),
                  onRestore: (path) =>
                    void runWithStatus(setStatus, "戻す", () =>
                      handleRestore(path),
                    ),
                  onDeleteForever: (path) =>
                    void runWithStatus(setStatus, "完全な削除", () =>
                      handleDeleteForever(path),
                    ),
                })}
              />
            </ContextMenu>
          )}
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
              currentText={historyBase}
              readVersion={(entry) =>
                vaultRoot && currentPath
                  ? historyRead(vaultRoot, currentPath, entry.path)
                  : Promise.resolve("")
              }
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
              items={outline.items}
              currentIndex={outline.currentIndex}
              onJump={(from) => editorRef.current?.revealPos(from)}
              onMenu={setOutlineMenu}
            />
          )}
        </div>
        <StatusBar
          status={status}
          stats={currentPath !== null ? outline.stats : null}
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
