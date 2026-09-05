import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
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
import type { FormatKind } from "./editor/format-commands";
import { FORMAT_TOOLBAR, formatHint } from "./editor/format-toolbar";
import { anchorAbove, menuPosition } from "./lib/context-menu";
import {
  AI_HANDOFFS,
  confirmMessage,
  handoffUrl,
  needsConfirm,
  searchUrl,
  SEARCH_HANDOFF,
  type Handoff,
} from "./lib/handoff";
import { finderTarget, TRASH_FOLDER } from "./lib/finder";
import { splitFolders } from "./lib/folder-tree";
import { folderFilterLabel, trashLabel, trashParts } from "./lib/trash-label";
import { canDropInto, isNoteDrag, NOTE_DRAG_TYPE } from "./lib/note-drop";
import { terms } from "./lib/keywords";
import { ASK_ACTION, ASSISTANT_ACTIONS } from "./lib/assistant-actions";
import { MENU_ICONS, type MenuIconName } from "./lib/menu-icons";
import { packSources, pickSources } from "./lib/sources";
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
import { appendChunk, llmErrorText, loadingNotice } from "./lib/assistant-text";
import { createDebouncer } from "./lib/debounce";
import {
  codeKey,
  collectCodeBlocks,
  renderBody,
  renderHtml,
} from "./lib/export-html";
import { highlightCodeHtml } from "./lib/export-code";
import { splitDeck } from "./lib/slides";
import { extractNote } from "./lib/extract";
import { buildGraph, DEFAULT_DEPTH, graphToMermaid } from "./lib/graph";
import { checkStyle, type Finding } from "./lib/style-check";
import { buildPptx, readTemplateTheme } from "./lib/pptx";
import { readSlideTheme } from "./lib/slide-theme";
import { readPptx, slidesToMarkdown } from "./lib/pptx-import";
import { toMarkdown } from "./lib/imported";
import { OCR_THRESHOLD, pdfPages } from "./lib/pdf-import";
import { rankCandidates } from "./lib/fuzzy";
import {
  clampFontSize,
  DEFAULT_FONT_PX,
  FONT_STEP_PX,
  MAX_FONT_PX,
  MIN_FONT_PX,
  loadFontSize,
  saveFontSize,
  zoomActionFor,
} from "./lib/font-size";
import {
  restoreLastVault,
  saveLastVault,
  vaultErrorText,
} from "./lib/last-vault";
import {
  loadSearches,
  removeSearch,
  saveSearches,
  upsertSearch,
  type SavedSearch,
} from "./lib/saved-searches";
import {
  clampPaneWidth,
  CONTEXT_CHOICES,
  contentWidthCss,
  CONTENT_WIDTHS,
  DEFAULT_SETTINGS,
  HISTORY_CHOICES,
  KEEP_ALIVE_CHOICES,
  LINE_SPACINGS,
  loadSettings,
  MAX_TRASH_DAYS,
  MIN_TRASH_DAYS,
  resolveTheme,
  saveSettings,
  TAB_WIDTHS,
  THEMES,
  type ContentWidth,
  type LineSpacing,
  type Settings,
  type Theme,
} from "./lib/settings";
import {
  formatStamp,
  sortNotes,
  type NoteEntry,
  type SortOrder,
} from "./lib/note-order";
import {
  conflictCopy,
  createNote,
  deleteForever,
  emptyTrash,
  historyList,
  clearRecovery,
  createFolder,
  duplicateNote,
  registerTemplate,
  createFromTemplate,
  dailyNote,
  deleteFolder,
  linkMap,
  moveNote,
  noteBacklinks,
  noteExists,
  noteRelated,
  notesInFolder,
  pendingRecovery,
  renameFolder,
  restoreRecovery,
  stashNote,
  syncIndex,
  trashAttachments,
  unusedAttachments,
  discardStash,
  historyRestore,
  imageSource,
  notesWithTag,
  placeManual,
  templateList,
  pinNote,
  readNote,
  saveAttachment,
  renameNote,
  restoreNote,
  searchNotes,
  trashNote,
  useAppStore,
  writeNote,
  type Backlink,
  type RelatedNote,
  type HistoryEntry,
  type SearchHit,
  type SyncResult,
} from "./stores/app";
import "./App.css";

// Phase 1 の骨格 UI: フォルダを開く → ノート一覧 → 編集 → 800ms 自動保存 →
// 新規・改名・ゴミ箱。3 ペイン構成・タグ・検索（spec §5.1）は後のフェーズで載せる。

const AUTOSAVE_DELAY_MS = 800; // spec §7.4
/// 退避の間隔（H-1）。打つたびに書くとディスクを叩きすぎるので間を空ける。
/// 自動保存が 800ms で走るのでここまで来ることは少ないが、**打ち続けて
/// いる間**（デバウンスが伸び続ける）と保存できない状態の保険になる
const STASH_INTERVAL_MS = 2000;

function noteLabel(root: string, path: string): string {
  const relative = path.startsWith(root) ? path.slice(root.length + 1) : path;
  return relative.replace(/\.(md|markdown)$/i, "");
}

function noteStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(md|markdown)$/i, "");
}

const THEME_LABELS: Record<Theme, string> = {
  system: "システムに合わせる",
  light: "ライト",
  dark: "ダーク",
};

const SPACING_LABELS: Record<LineSpacing, string> = {
  tight: "詰めて",
  normal: "ふつう",
  relaxed: "ゆったり",
};

/// 右クリックのメニュー（枠と置き場所）。
///
/// **高さを見積もらない。** 項目が増えるたびに見積もりを直すことになり、
/// 直し忘れると窓の下で切れて**最後の項目が押せなくなる**（実機報告
/// 2026-09-05）。出してから測って置き直す。
/// 画面より高いメニューは、そのまま中で送れるようにする（CSS の max-height）。
function ContextMenu({
  at,
  onClose,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const spot = menuPosition(
      at,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced({ left: spot.x, top: spot.y });
  }, [at]);
  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <ul
        ref={list}
        className="context-menu"
        // 測るまでは押した場所に置き、置き場所が決まるまで見せない
        // （一瞬ずれた場所に出るのを避ける）
        style={{
          left: placed?.left ?? at.x,
          top: placed?.top ?? at.y,
          visibility: placed ? "visible" : "hidden",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </ul>
    </div>
  );
}

/// 右クリックのメニューの中の枝（要望 2026-09-05）。
///
/// **`position: fixed` で出す。** 親のメニューは高いときに中で送れるよう
/// `overflow` を持っているので、その中に置くと枝が切られる。固定なら
/// 親の外に出られる。右端で開いたときは左へ返す。
function SubMenu({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const item = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // 希望の位置（項目の横）と、測って決めた置き場所を分けて持つ
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );
  const place = () => {
    const box = item.current?.getBoundingClientRect();
    if (!box) return;
    // 横は開く向きだけ決める（右端なら左へ返す）。**縦は測ってから**
    const flip = box.right + SUBMENU_WIDTH > window.innerWidth;
    setAt({
      // 少し重ねる（親から枝へマウスを移すときに間で切れない）
      left: flip ? box.left - SUBMENU_WIDTH + 4 : box.right - 4,
      top: box.top - 4,
    });
  };
  // **枝も高さを見積もらない。** 窓の下のほうで開くと、下が切れて最後の
  // 相手が押せなくなる（実機報告 2026-09-05）
  useLayoutEffect(() => {
    if (!at) {
      setPlaced(null);
      return;
    }
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const spot = menuPosition(
      { x: at.left, y: at.top },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlaced({ left: spot.x, top: spot.y });
  }, [at]);
  return (
    <li
      ref={item}
      className="has-submenu"
      onMouseEnter={place}
      onFocus={place}
      onMouseLeave={() => setAt(null)}
    >
      <button type="button">
        {icon}
        {label}
        <span className="submenu-arrow" aria-hidden="true">
          ▶
        </span>
      </button>
      {at && (
        <ul
          ref={list}
          className="context-menu context-submenu"
          style={{
            ...(placed ?? at),
            visibility: placed ? "visible" : "hidden",
          }}
        >
          {children}
        </ul>
      )}
    </li>
  );
}

/// 枝の幅（置く向きを決めるのに使う）。CSS の `min-width` と揃える。
const SUBMENU_WIDTH = 176;

/// メニューの項目に添える絵。**名前で引く**（同じ言葉には同じ絵）。
function MenuIcon({ name }: { name: MenuIconName }) {
  return (
    <svg className="menu-icon" viewBox="0 0 16 16" aria-hidden="true">
      {MENU_ICONS[name].map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/// バイト数の見せ方（設定画面の「履歴の使用量」）。
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const WIDTH_LABELS: Record<ContentWidth, string> = {
  standard: "標準",
  wide: "広め",
  full: "最大（ウィンドウ幅）",
};

/// 保存時刻（時:分）。日付は出さない — 開いている間に保存した時刻なので、
/// 日付まで出すと情報が増えるだけで読み取りが遅くなる。
function clockOf(at: number): string {
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/// フォルダ行の見出し。直下（空文字）だけ名前を付け、あとは末端の名前。
function folderLabel(folder: string): string {
  if (!folder) return "直下";
  return folder.split("/").pop() ?? folder;
}

/// 階層の深さ（直下は 0）。ツリーの字下げに使う。
function folderDepth(folder: string): number {
  return folder ? folder.split("/").length : 0;
}

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
  const autosave = useMemo(() => createDebouncer(AUTOSAVE_DELAY_MS), []);
  // flush 時に「どのノートの内容か」を取り違えないよう、保存関数ごと持つ
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  // 外部変更イベントのハンドラは一度だけ登録するので、最新値は ref で読む
  const vaultRootRef = useRef(vaultRoot);
  vaultRootRef.current = vaultRoot;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const dirtyRef = useRef(false); // 保存されていない編集があるか
  const [query, setQuery] = useState("");
  // メニューのハンドラは一度だけ登録するので、最新の式は ref で読む
  const queryRef = useRef(query);
  queryRef.current = query;
  const [hits, setHits] = useState<SearchHit[]>([]);
  // 保存した検索（K-4）。名前を付けた検索式をサイドバーに置く
  const [searches, setSearches] = useState<SavedSearch[]>(() =>
    loadSearches(localStorage),
  );
  // 「検索を保存…」の名前入力。null は閉じている
  const [savingSearch, setSavingSearch] = useState<string | null>(null);
  const searchName = useRef<HTMLInputElement>(null);

  function keepSearches(next: SavedSearch[]) {
    setSearches(next);
    saveSearches(localStorage, next);
  }

  function confirmSaveSearch() {
    const name = searchName.current?.value.trim() ?? "";
    const typed = savingSearch?.trim() ?? "";
    if (!name || !typed) return;
    setSavingSearch(null);
    // 同じ名前は上書き（検索式の更新に使う）
    keepSearches(upsertSearch(searches, { name, query: typed }));
    setStatus(`検索「${name}」を保存しました`);
  }

  // タグでの絞り込み（C-4）。検索とは排他 — どちらも一覧の中身を差し替える
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteEntry[]>([]);
  // フォルダでの絞り込み（ADR-0024）。null は絞っていない、"" は直下
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [folderNotes, setFolderNotes] = useState<NoteEntry[]>([]);
  const searchSoon = useMemo(() => createDebouncer(200), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 一覧の並び順（C-3 相当）。選び直したら覚える
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    try {
      return localStorage.getItem("oboegaki.sort") === "title"
        ? "title"
        : "modified";
    } catch {
      return "modified";
    }
  });
  /// ゴミ箱を見ているか（一覧の中身が捨てたノートに変わる）。
  const trashView = folderFilter === TRASH_FOLDER;
  const sortedNotes = useMemo(() => {
    const listed =
      folderFilter !== null ? folderNotes : tagFilter ? tagNotes : notes;
    return sortNotes(listed, sortOrder);
  }, [notes, tagNotes, tagFilter, folderNotes, folderFilter, sortOrder]);
  function changeSort(order: SortOrder) {
    setSortOrder(order);
    try {
      localStorage.setItem("oboegaki.sort", order);
    } catch {
      // 保存できなくても切り替え自体は生かす
    }
  }
  // 環境設定（TASKS 3-9）。変えたらすぐ効かせて覚える
  const [settings, setSettings] = useState<Settings>(() =>
    loadSettings(localStorage),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [preferences, setPreferences] = useState(false);
  const [prefTab, setPrefTab] = useState<"general" | "assistant">("general");
  const [historyUsage, setHistoryUsage] = useState<number | null>(null);
  // Ollama に入っているモデル（設定のモデル欄の選択肢）。無ければ空
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  // キャンセルで戻すためのスナップショット（開いた瞬間の設定と文字サイズ）
  const prefSnapshot = useRef<{ settings: Settings; fontSize: number } | null>(
    null,
  );

  function openPreferences() {
    prefSnapshot.current = {
      settings: settingsRef.current,
      fontSize: fontSizeRef.current,
    };
    setHistoryUsage(null);
    setPreferences(true);
    const root = vaultRootRef.current;
    if (root) {
      invoke<number>("history_usage", { root })
        .then((bytes) => setHistoryUsage(bytes))
        .catch(() => setHistoryUsage(0));
    } else {
      setHistoryUsage(0);
    }
    // モデル欄の選択肢。**入っていない名前を打たせない**ためのもの
    // （名前違いの 404 で「返ってこない」ように見えた実機の事故から）
    invoke<string[]>("llm_models", { port: settingsRef.current.llmPort })
      .then((found) => setInstalledModels(found))
      .catch(() => setInstalledModels([]));
  }

  function cancelPreferences() {
    const kept = prefSnapshot.current;
    if (kept) {
      changeSettings(kept.settings);
      changeFontSize(kept.fontSize);
    }
    setPreferences(false);
  }

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
  /// 掴んだときに持ち歩く札。**行そのものを絵にしない** — WebKit は行の
  /// 載っている層ごと写し取るので、窓の幅いっぱいの帯になって隣のペインの
  /// 本文まで一緒に動く（実機で発覚 2026-09-04）
  const dragGhost = useRef<HTMLElement | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
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
  const [dropTrash, setDropTrash] = useState(false);
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
  const [noteMenu, setNoteMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  // 「テンプレートに登録…」の名前入力。null は閉じている
  const [templateName, setTemplateName] = useState<string | null>(null);
  const templateInput = useRef<HTMLInputElement>(null);
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
      await autosave.flush();
      await refresh();
      setStatus(`「${created}」に切り出しました`);
    } catch (error) {
      setStatus(`切り出せませんでした: ${String(error)}`);
    }
  }

  async function handleDuplicate(path: string) {
    if (!vaultRoot) return;
    await autosave.flush(); // 打ちかけを書き切ってから写す
    try {
      const copy = await duplicateNote(vaultRoot, path);
      await refresh();
      await openNote(copy);
      setStatus("複製しました");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function confirmRegisterTemplate() {
    const typed = templateInput.current?.value.trim() ?? "";
    const path = templateName;
    if (!vaultRoot || !path || !typed) return;
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
  const [headingQuery, setHeadingQuery] = useState("");
  const [headingIndex, setHeadingIndex] = useState(0);

  /// 今のノートの見出しでパレットを開く。**空のパレットは出さない**
  /// （何も無いことが分かればよい）。
  function openHeadingPalette() {
    const found = editorRef.current?.getOutline() ?? [];
    if (found.length === 0) {
      setStatus("このノートには見出しがありません");
      return;
    }
    setHeadingQuery("");
    setHeadingIndex(0);
    setHeadings(found);
  }

  function jumpToHeading(item: OutlineItem | undefined) {
    if (!item) return;
    setHeadings(null);
    editorRef.current?.revealPos(item.from);
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
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
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
    const sources = new Set(
      [...html.matchAll(/<img src="([^"]+)"/g)].map((found) => found[1]),
    );
    let embedded = html;
    for (const src of sources) {
      const data = await imageSource(root, src);
      if (data) embedded = embedded.split(`src="${src}"`).join(`src="${data}"`);
    }
    return embedded;
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
    await autosave.flush(); // 保存前の本文を刷らない
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
    await autosave.flush(); // 保存前の本文を書き出さない
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const target = await save({
      defaultPath: `${title}.pptx`,
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (!target) return;
    setStatus("PowerPoint を組んでいます…");
    try {
      // 見た目はノートの front matter から（TASKS 5-5）
      const data = await buildPptx(
        splitDeck(text),
        (url) => imageSource(vaultRoot, url),
        readSlideTheme(text),
        await borrowedTheme(),
      );
      await invoke("export_write_binary", { path: target, data });
      setStatus(`書き出しました: ${target}`);
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
  async function readPdfPages(bytes: Uint8Array, data: string) {
    const pages = await pdfPages(bytes);
    const count =
      pages.length || (await invoke<number>("pdf_page_count", { data }));
    const found: string[] = [];
    for (let index = 0; index < count; index++) {
      const page = pages[index] ?? "";
      if (page.trim().length >= OCR_THRESHOLD) {
        found.push(page); // 速くて正確なほうを黙って捨てない
        continue;
      }
      setStatus(`文字を読み取っています… ${index + 1}/${count} ページ`);
      // **絵にするのも Rust の仕事**（同じ機械の中で完結させる）
      const read = await invoke<string>("ocr_pdf_page", {
        data,
        page: index + 1,
      });
      // **読み取りが元より短ければ捨てる**（外すこともあるので、短くても
      // 本物の文字が入っているページを潰さない）
      found.push(read.trim().length > page.trim().length ? read : page);
    }
    return found;
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
      if (/\.(png|jpe?g|heic|tiff?)$/i.test(name)) {
        markdown = toMarkdown(
          [await invoke<string>("ocr_image", { data })],
          title,
        );
      } else if (/\.pdf$/i.test(name)) {
        markdown = toMarkdown(await readPdfPages(bytes, data), title);
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
      setStatus("読み込みました（見た目は戻りません。手で整えてください）");
    } catch (error) {
      setStatus(`読み込めませんでした: ${String(error)}`);
    }
  }

  async function handleExport() {
    if (!vaultRoot || !currentPath) return;
    await autosave.flush(); // 保存前の本文を書き出さない
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
  const [templateIndex, setTemplateIndex] = useState(0);
  // フォルダの作成・改名の入力（ADR-0024）。null は閉じている
  const [folderDialog, setFolderDialog] = useState<{
    kind: "create" | "rename";
    folder: string; // create: 親（"" は直下）/ rename: 対象
  } | null>(null);
  const folderName = useRef<HTMLInputElement>(null);
  // 「フォルダへ移動…」の行き先選び。null は閉じている
  const [moveOpen, setMoveOpen] = useState(false);
  // 雛形の `{{cursor}}`。開いた直後のキャレット位置としてエディタへ渡す
  const [initialCursor, setInitialCursor] = useState<number | null>(null);
  // このノートを指しているノート（E-6）。本文の下に畳んで出す
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const tableRows = useRef<HTMLInputElement>(null);
  const tableColumns = useRef<HTMLInputElement>(null);
  function confirmInsertTable() {
    const rows = Number(tableRows.current?.value ?? 2);
    const columns = Number(tableColumns.current?.value ?? 2);
    setTableDialog(false);
    editorRef.current?.insertTable(
      Number.isFinite(rows) ? rows : 2,
      Number.isFinite(columns) ? columns : 2,
    );
  }

  // 版の履歴（ADR-0023）
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(
    null,
  );

  async function openHistory() {
    if (!vaultRoot || !currentPath) return;
    await autosave.flush(); // 未保存分を書き切ってから一覧を出す
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
    autosave.cancel();
    const ok = await confirm(
      `${entry.stamp} の版に戻しますか？\n（今の内容も履歴に残ります）`,
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    let text: string;
    try {
      text = await historyRestore(vaultRoot, currentPath, entry.path);
    } catch (error) {
      setStatus(`版を戻せませんでした: ${String(error)}`);
      return;
    }
    pendingSave.current = null;
    dirtyRef.current = false;
    editorRef.current?.replaceText(text);
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
  const [cursorPos, setCursorPos] = useState(0);
  const outlineSoon = useMemo(() => createDebouncer(300), []);
  // ステータスバーの統計（TASKS 3-10）。**打鍵ごとには数えない**
  // （全文の走査は 16ms の予算を食う）。打ち終わってからまとめて数える
  const [stats, setStats] = useState<TextStats>({ characters: 0, lines: 0 });
  const statsSoon = useMemo(() => createDebouncer(300), []);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
    await autosave.flush(); // 前の vault の未保存分を書き切ってから移る
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
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);

  // 関連するノート（L-3）。**モデルは通さない**ので、Ollama が無くても出る
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [relatedShown, setRelatedShown] = useState(false);
  // vault 全体への質問（L-2）と、そのとき渡した材料
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<SearchHit[]>([]);

  // 開いているノートが変わったら引き直す（索引が更新されたときも）
  useEffect(() => {
    if (!assistantOpen || !vaultRoot || !currentPath || !relatedShown) {
      setRelated([]);
      return;
    }
    let alive = true;
    void noteRelated(vaultRoot, currentPath, noteStem(currentPath))
      .then((found) => {
        if (alive) setRelated(found);
      })
      .catch(() => {
        if (alive) setRelated([]);
      });
    return () => {
      alive = false;
    };
  }, [assistantOpen, vaultRoot, currentPath, notes, relatedShown]);

  // 別のノートに移ったら畳む（前のノートの関連が残っていると読み違える）
  useEffect(() => {
    setRelatedShown(false);
    setSources([]);
  }, [currentPath]);

  // 開いたときだけ動いているか確かめる（**押してから断らない**）
  useEffect(() => {
    if (!assistantOpen) return;
    let alive = true;
    void invoke<boolean>("llm_available", { port: settings.llmPort })
      .then((found) => {
        if (alive) setLlmReady(found);
      })
      .catch(() => {
        if (alive) setLlmReady(false);
      });
    return () => {
      alive = false;
    };
  }, [assistantOpen, settings.llmPort]);

  // 流れてきたぶんから順に出す（最初の 1 文字まで数秒あり、黙って待たせない）
  useEffect(() => {
    const chunks = safeSubscribe(() =>
      listen<string>("llm-chunk", (event) => {
        setAnswer((current) => appendChunk(current, event.payload));
      }),
    );
    const done = safeSubscribe(() =>
      listen<string>("llm-done", () => setThinking(false)),
    );
    const failed = safeSubscribe(() =>
      listen<string>("llm-failed", (event) => {
        setThinking(false);
        setAnswer(
          llmErrorText(
            event.payload,
            settingsRef.current.llmTimeoutMinutes,
            settingsRef.current.llmModel,
          ),
        );
      }),
    );
    return () => {
      chunks();
      done();
      failed();
    };
  }, []);

  /// 生成を始める。**入口を 1 つにする** — 要約・レビュー・質問で
  /// 送るものは違っても、設定の渡し方と断り方は同じ。
  async function startGeneration(order: {
    task: string;
    title: string;
    body: string;
    question?: string;
    sources?: [string, string][];
  }): Promise<boolean> {
    return invoke<boolean>("llm_generate", {
      port: settings.llmPort,
      model: settings.llmModel,
      context: settings.llmContext,
      timeoutMinutes: settings.llmTimeoutMinutes,
      keepAlive: settings.llmKeepAlive,
      ...order,
    });
  }

  /// 押すたびに画面を空にする（要望 2026-09-04）。**前の答えを残さない** —
  /// 残っていると、新しい問いの答えが出るまでのあいだ、前の答えを新しい
  /// ものと読み違える。
  function clearAssistant() {
    setAnswer("");
    setSources([]);
    setRelatedShown(false);
  }

  /// 走っている生成を止める（L-1）。**受け取ったぶんは消さない。**
  function stopAssistant() {
    void invoke("llm_stop").catch(() => {});
  }

  /// 関連するノートを出す（L-3）。**モデルを通さない** — 関係の根拠は
  /// 索引の中にある（同じタグ・`[[…]]` の指し合い・題名の言及）。
  function showRelated() {
    clearAssistant();
    setRelatedShown(true);
  }

  /// vault 全体に質問する（L-2 / ADR-0025）。
  ///
  /// **材料はこちらが選ぶ。** 索引で候補を引き、その本文を渡す。渡した
  /// ノートを画面に出せるのはこちら側だけなので、出典を作文させない。
  async function askQuestion() {
    const asked = question.trim();
    if (!vaultRoot || !asked || thinking) return;
    clearAssistant();
    // **質問をそのまま探さない。** 全文検索は打った通りの並びを探すので、
    // 「予算について何が決まった？」ではどこにも当たらない（lib/keywords）
    const words = terms(asked);
    const hits: SearchHit[] = [];
    for (const word of words.length > 0 ? words : [asked]) {
      try {
        const outcome = await searchNotes(vaultRoot, word);
        hits.push(...outcome.hits);
      } catch {
        // 1 語探せなくても、残りの語で続ける
      }
    }
    const picked = pickSources(hits);
    if (picked.length === 0) {
      // 材料の無い問いに答えさせない（作り話が出る）
      setAnswer(
        "材料になるノートが見つかりませんでした。言葉を変えて試してください。",
      );
      return;
    }
    // **出典は答えより先に出す。** 待っている間、何を見ているのか分かる
    setSources(picked);
    const bodies = await Promise.all(
      picked.map((hit) =>
        readNote(vaultRoot, `${vaultRoot}/${hit.path}`).catch(() => ""),
      ),
    );
    const packed = packSources(
      picked.map((hit, index) => ({ title: hit.title, body: bodies[index] })),
    );
    setThinking(true);
    const started = await startGeneration({
      task: "question",
      title: "",
      body: "",
      question: asked,
      sources: packed,
    });
    if (!started) {
      setThinking(false);
      setAnswer("いま考えています。終わるまでお待ちください。");
    }
  }

  /// ノートを読ませる。**本文は書き換えない**（答えは横に出すだけ）。
  async function askAssistant(task: string) {
    if (!vaultRoot || !currentPath) return;
    await autosave.flush(); // 打ちかけを書き切ってから読ませる
    const text = editorRef.current?.getText() ?? "";
    clearAssistant();
    setThinking(true);
    const started = await startGeneration({
      task,
      title: noteStem(currentPath),
      body: text,
    });
    if (!started) {
      setThinking(false);
      setAnswer("いま考えています。終わるまでお待ちください。");
      return;
    }
    // 載っていなければ読み込みから（6 分の沈黙は壊れて見える）。
    // **先に届いた断りや答えを上書きしない**（loadingNotice が判断する）—
    // モデル名の間違いの 404 は、この確認より速く返ることがある
    const loaded = await invoke<boolean>("llm_loaded", {
      port: settings.llmPort,
      model: settings.llmModel,
    });
    if (!loaded) setAnswer(loadingNotice);
  }

  async function handleUnloadModel() {
    // 使わない設定なら、載っているモデルも無い（触りに行かない）
    if (!settings.assistantEnabled) {
      setStatus("アシスタントは環境設定で切ってあります");
      return;
    }
    const done = await invoke<boolean>("llm_unload", {
      port: settings.llmPort,
      model: settings.llmModel,
    });
    setStatus(
      done
        ? "モデルを降ろしました"
        : "いま考えています（終わってから降ろせます）",
    );
  }

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

  // 開いた vault の**一番上のノートを開く**（要望 2026-09-04）。
  //
  // **vault ごとに一度だけ。** 一覧が変わるたびに開き直すと、ノートを
  // 捨てたり絞り込んだりしたときに、勝手に別のノートへ飛んでしまう。
  // 既に何か開いていれば触らない（復元や引き継ぎを上書きしない）。
  const openedFirstFor = useRef<string | null>(null);
  useEffect(() => {
    if (!vaultRoot || currentPath) return;
    if (openedFirstFor.current === vaultRoot) return;
    const first = sortedNotes[0];
    if (!first) return; // 空の vault では何もしない
    openedFirstFor.current = vaultRoot;
    void openNote(first.path);
    // openNote は毎描画で作り直されるが、開くかどうかは上の条件で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultRoot, currentPath, sortedNotes]);

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

  // 前回の未保存内容があれば知らせる（H-1）。**勝手には復元しない** —
  // 復元は別ファイルとして書き出すので、要らないものが増えては困る
  useEffect(() => {
    if (!vaultRoot) return;
    let alive = true;
    void pendingRecovery(vaultRoot)
      .then((found) => {
        if (alive) setRecovery(found.length);
      })
      .catch(() => {}); // 退避が読めないせいで起動を止めない
    return () => {
      alive = false;
    };
  }, [vaultRoot]);

  async function handleRecovery(restore: boolean) {
    if (!vaultRoot) return;
    setRecovery(0);
    if (!restore) {
      await clearRecovery(vaultRoot);
      return;
    }
    const written = await restoreRecovery(vaultRoot);
    await refresh();
    if (written[0]) await openNote(written[0]);
    setStatus(`未保存の内容を ${written.length} 件、別ファイルに復元しました`);
  }

  async function openNote(path: string, cursor: number | null = null) {
    if (!vaultRoot) return;
    await autosave.flush(); // 前のノートの未保存分を書き切ってから切り替える
    let text: string;
    try {
      text = await readNote(vaultRoot, path);
    } catch (error) {
      // 一覧と実体がずれている（外で消された等）。無反応に見せない
      setStatus(`開けませんでした: ${String(error)}`);
      return;
    }
    selectNote(path);
    setInitialCursor(cursor);
    setDoc(text);
    dirtyRef.current = false;
    setStatus("");
    setSavedAt(null);
    setPrintBody(null); // 前のノートの印刷用の組みは捨てる（ADR-0038）
  }

  /// 新しいノート（Cmd+N・フォルダの右クリック）。
  /// フォルダを渡すとその中に作る（空文字は直下）。
  async function handleCreate(folder = "") {
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
    setTemplateIndex(0);
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
  async function handleDailyNote() {
    if (!vaultRoot) return;
    const made = await dailyNote(vaultRoot);
    await refresh();
    await openNote(made.path, made.cursor);
  }

  /// 使い方のノートを今の内容で置き直す（ヘルプ）。既にあるノートは
  /// 消さず、別のファイルとして置かれる。
  async function handlePlaceManual() {
    if (!vaultRoot) return;
    const placed = await placeManual(vaultRoot);
    await refresh();
    await openNote(placed);
  }

  async function confirmFolderName() {
    const typed = folderName.current?.value.trim() ?? "";
    const dialog = folderDialog;
    if (!vaultRoot || !dialog || !typed) return;
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
          await autosave.flush();
          await openNote(moved);
        }
        if (folderFilter === dialog.folder) setFolderFilter(renamed);
        setStatus(`フォルダの名前を「${typed}」に変えました`);
      }
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
      if (folderFilter === folder) setFolderFilter(null);
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
    if (open) await autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
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
    await autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
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

  async function handleRename(title: string) {
    if (!vaultRoot || !currentPath || renaming.current) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === noteStem(currentPath)) return;
    renaming.current = true;
    await autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const renamed = await renameNote(vaultRoot, currentPath, trimmed);
      await refresh();
      const text = await readNote(vaultRoot, renamed);
      selectNote(renamed);
      setDoc(text);
    } catch (error) {
      setStatus(`改名に失敗: ${String(error)}`);
    } finally {
      renaming.current = false;
    }
  }

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
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    // 捨てるのが開いているノートなら、保存予約も破棄する
    if (path === currentPath) {
      autosave.cancel();
      pendingSave.current = null;
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
    }
    setStatus("");
  }

  // ピン留めの付け外し（spec §7.3）。front matter が書き換わるので、
  // 開いているエディタの内容も返ってきた本文で差し替える
  async function handlePin(target?: string) {
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    const current = notes.find((entry) => entry.path === path);
    await autosave.flush(); // 未保存分を書き切ってから front matter を触る
    let text: string;
    try {
      text = await pinNote(vaultRoot, path, !current?.pinned);
    } catch (error) {
      setStatus(`ピン留めに失敗: ${String(error)}`);
      return;
    }
    // 開いているノートなら、書き換わった front matter を読み直す
    if (path === currentPath) {
      dirtyRef.current = false;
      editorRef.current?.replaceText(text);
    }
    await refresh();
    setStatus(current?.pinned ? "ピンを外しました" : "ピン留めしました");
  }

  function handleQueryChanged(next: string) {
    setQuery(next);
    if (next.trim()) {
      // 検索・タグ・フォルダは排他（どれも一覧の中身を差し替える）
      setTagFilter(null);
      setFolderFilter(null);
    }
    if (!next.trim()) {
      searchSoon.cancel();
      setHits([]);
      return;
    }
    searchSoon.schedule(() => {
      const root = vaultRootRef.current;
      if (!root) return;
      searchNotes(root, next)
        .then((outcome) => {
          // 世代ガード: 遅いクエリの結果が、後から打った新しいクエリの
          // 結果を上書きしない（レビュー 2026-09-04）。デバウンスは予約を
          // 絞るだけで、発射済みの invoke は絞れない
          if (queryRef.current !== next) return;
          setHits(outcome.hits);
          // 読めない日付を黙って絞りに使わない。0 件になった理由が
          // 画面から読めないと、打ち間違いに気づけない
          setStatus(
            outcome.unreadable.length > 0
              ? `日付として読めません: ${outcome.unreadable.join(" ")}（例: after:2026-09-03）`
              : "",
          );
        })
        .catch((error) => {
          if (queryRef.current !== next) return;
          setStatus(`検索に失敗: ${String(error)}`);
        });
    });
  }

  /// タグで一覧を絞る（null で解除）。検索とは排他。
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

  /// 選んだ文字を外のサービスへ渡す（要望 2026-09-05）。
  ///
  /// **このアプリで初めて、ノートの中身が外へ出る道。** 押したときだけ動き、
  /// 渡すのは選んだところだけ。生成 AI の前には確認を挟む（環境設定で切れる）。
  async function handOff(handoff: Handoff) {
    const selected = editorRef.current?.getSelection() ?? "";
    if (!selected.trim()) return;
    if (needsConfirm(handoff, settingsRef.current.confirmHandoff)) {
      const ok = await confirm(confirmMessage(handoff, selected), {
        title: "覚書",
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

  function filterByTag(tag: string | null) {
    setTagFilter(tag);
    if (tag) {
      setFolderFilter(null);
      searchSoon.cancel();
      setQuery("");
      setHits([]);
    }
  }

  // 絞り込み中のタグのノートを引き直す。notes が変わったとき（= 索引が
  // 更新されたとき）も引き直して、絞った一覧を置き去りにしない
  useEffect(() => {
    if (!vaultRoot || !tagFilter) {
      setTagNotes([]);
      return;
    }
    let alive = true;
    void notesWithTag(vaultRoot, tagFilter).then((found) => {
      if (alive) setTagNotes(found);
    });
    return () => {
      alive = false;
    };
  }, [vaultRoot, tagFilter, notes]);

  /// フォルダで一覧を絞る（null で解除）。検索・タグとは排他。
  function filterByFolder(folder: string | null) {
    setFolderFilter(folder);
    if (folder !== null) {
      searchSoon.cancel();
      setQuery("");
      setHits([]);
      setTagFilter(null);
    }
  }

  // 絞り込み中のフォルダのノートを引き直す（notes が変わったとき =
  // 索引が更新されたときも）
  useEffect(() => {
    // **ゴミ箱は索引に無い**（T7 の走査対象外）。引きに行っても空なので、
    // trash_list から来る `trashNotes` をそのまま一覧に出す
    if (!vaultRoot || folderFilter === null || folderFilter === TRASH_FOLDER) {
      setFolderNotes([]);
      return;
    }
    let alive = true;
    void notesInFolder(vaultRoot, folderFilter).then((found) => {
      if (alive) setFolderNotes(found);
    });
    return () => {
      alive = false;
    };
  }, [vaultRoot, folderFilter, notes]);

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
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    await deleteForever(vaultRoot, path);
    await refresh();
  }

  async function handleEmptyTrash() {
    if (!vaultRoot) return;
    const ok = await confirm(
      `ゴミ箱の ${trashNotes.length} 件をすべて完全に削除しますか？\nこの操作は取り消せません。`,
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    await emptyTrash(vaultRoot);
    await refresh();
  }

  // 退避してあるノート（保存できたら捨てに行くため覚えておく）
  const stashed = useRef(new Set<string>());
  const lastStash = useRef(0);

  async function keepStash(root: string, path: string, text: string) {
    try {
      await stashNote(root, path, text);
      stashed.current.add(path);
    } catch (error) {
      // 退避に失敗しても編集は続けられる。ここで止めない
      console.warn("未保存内容の退避に失敗した", error);
    }
  }

  function handleDocChanged(getText: () => string) {
    if (!vaultRoot || !currentPath) return;
    const root = vaultRoot;
    const path = currentPath;
    dirtyRef.current = true;
    setStatus("未保存");
    pendingSave.current = async () => {
      await writeNote(
        root,
        path,
        getText(),
        settingsRef.current.historyMinutes,
      );
      // 完了する頃には別のノートが開いているかもしれない。共有の
      // dirty と表示を触るのは**今もそのノートを開いているときだけ**
      //（レビュー 2026-09-04: 取り違えると次の外部変更が「未編集」と
      // 判定され、打ったばかりの内容が静かにリロードで消える）
      if (currentPathRef.current === path) {
        dirtyRef.current = false;
        setStatus("保存済み");
        setSavedAt(Date.now());
      }
      // 書けたので保険は要らない。**退避したときだけ**捨てに行く
      // （毎回の保存でディスクを余分に叩かない）
      if (stashed.current.delete(path)) void discardStash(root, path);
    };
    // 打ち続けている間はデバウンスが伸びて保存が走らない。その間も
    // 一定の間隔で退避しておく（H-1）
    const now = Date.now();
    if (now - lastStash.current >= STASH_INTERVAL_MS) {
      lastStash.current = now;
      void keepStash(root, path, getText());
    }
    autosave.schedule(async () => {
      // Promise を返す（= flush が完了を待てる）。失敗はここで受け止める
      await pendingSave.current?.().catch((error) => {
        if (currentPathRef.current === path) {
          setStatus(`保存に失敗: ${String(error)}`);
        }
        // 保存できないまま落ちても書いたものを失わない（H-1）
        void keepStash(root, path, getText());
      });
    });
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

  // アンマウント時（ウィンドウを閉じる直前の React 破棄）にも書き切る
  useEffect(
    () => () => {
      void autosave.flush(); // 完了は待てない（React の破棄は同期）
    },
    [autosave],
  );

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
    "move-note": () => {
      if (currentPathRef.current) setMoveOpen(true);
    },
    "place-manual": () => void handlePlaceManual(),
    preferences: openPreferences,
    "open-vault": () => void chooseVault(),
    resync: () => void handleSync(false),
    "rebuild-index": () => void handleSync(true),
    "cleanup-attachments": () => void handleCleanupAttachments(),
    save: () => autosave.flush(),
    "export-html": () => void handleExport(),
    "export-pptx": () => void handleExportPptx(),
    "export-pdf": () => void handlePrint(true),
    "import-pptx": () => void handleImportPptx(),
    print: () => void handlePrint(),
    history: () => void openHistory(),
    trash: () => void handleTrash(),
    "quick-open": () => {
      setQuickOpen((open) => !open);
      setPaletteQuery("");
      setPaletteIndex(0);
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
    "llm-unload": () => void handleUnloadModel(),
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
    await autosave.flush();
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
    await autosave.flush();
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

  // 外部変更（spec §7.5）。一覧は少し待ってまとめて更新し、開いている
  // ノートは未編集なら静かにリロード、編集中なら確認を挟む
  const refreshSoon = useMemo(() => createDebouncer(300), []);
  useEffect(() => {
    const unlisten = safeSubscribe(() =>
      listen<{ path: string; kind: string }>(
        "vault-changed",
        (event) => void handleExternalChange(event.payload),
      ),
    );
    return unlisten;
    // eslint 相当の依存警告は無い構成だが、意図として登録は一度だけ。
    // ハンドラが読む値はすべて ref 経由
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExternalChange(change: { path: string; kind: string }) {
    if (!vaultRootRef.current) return;
    refreshSoon.schedule(() =>
      useAppStore
        .getState()
        .refresh()
        .catch((error) =>
          setStatus(`一覧を更新できませんでした: ${String(error)}`),
        ),
    );
    if (change.path !== currentPathRef.current) return;
    if (change.kind === "removed") {
      // 改名・ゴミ箱移動の途中経過でも届くので、**本当に無いときだけ聞く**
      const root = vaultRootRef.current;
      const gone = !(await noteExists(root, change.path));
      if (!gone) return;
      // **自動保存を止める。** 止めないと、聞いている間に予約が起きて
      // 消えたファイルを黙って作り直してしまう
      autosave.cancel();
      // 聞いている間は保存できない状態。書いたものは退避しておく（H-1）
      void keepStash(root, change.path, editorRef.current?.getText() ?? "");
      setDeleted(change.path);
      return;
    }
    const root = vaultRootRef.current;
    const text = await readNote(root, change.path);
    if (!dirtyRef.current) {
      editorRef.current?.replaceText(text); // 静かにリロード（キャレット維持）
      return;
    }
    // 競合。3 択（外部 / 自分 / 両方残す = spec §7.5）をアプリ内の
    // ダイアログで聞く（ネイティブの ask は 2 択しかできない）。
    // **予約は先に破棄する** — 残したまま聞くと、答える前に自動保存が
    // 発火して自分の版で外部の変更を潰す（レビュー 2026-09-04）
    autosave.cancel();
    setConflict({ path: change.path, externalText: text });
    // 競合の解決を待つ間は保存できない。**その間も保険は要る**（H-1）
    void keepStash(root, change.path, editorRef.current?.getText() ?? "");
  }

  // 競合ダイアログ（spec §7.5）
  const [conflict, setConflict] = useState<{
    path: string;
    externalText: string;
  } | null>(null);

  // 前回の未保存内容（クラッシュ退避 / H-1）。0 件なら聞かない
  const [recovery, setRecovery] = useState<number>(0);

  // 開いているノートが外で消された（spec §7.5）
  const [deleted, setDeleted] = useState<string | null>(null);

  /// 編集中の内容で作り直す。
  async function recreateDeleted() {
    const path = deleted;
    if (!vaultRoot || !path) return;
    setDeleted(null);
    const text = editorRef.current?.getText() ?? "";
    try {
      await writeNote(
        vaultRoot,
        path,
        text,
        settingsRef.current.historyMinutes,
      );
      dirtyRef.current = false;
      if (stashed.current.delete(path)) void discardStash(vaultRoot, path);
      await refresh();
      setStatus("編集中の内容で作り直しました");
    } catch (error) {
      setStatus(`作り直せませんでした: ${String(error)}`);
    }
  }

  /// 作り直さずに閉じる。**本文だけ消すのでは足りない** — 題名や
  /// 未保存の予約に消えたノートが残ると、表示が嘘をつく。
  function closeDeleted() {
    setDeleted(null);
    autosave.cancel();
    pendingSave.current = null;
    dirtyRef.current = false;
    selectNote(null);
    setDoc(null);
    setStatus("外部で削除されたので閉じました（退避は残してあります）");
  }

  function adoptExternal(text: string) {
    autosave.cancel();
    pendingSave.current = null;
    dirtyRef.current = false;
    editorRef.current?.replaceText(text);
  }

  async function resolveConflict(choice: "external" | "mine" | "both") {
    if (!conflict || !vaultRoot) return;
    const found = conflict;
    setConflict(null);
    // どの道を選んでも「保存できない状態」は終わる。保険は捨てる
    if (stashed.current.delete(found.path)) {
      void discardStash(vaultRoot, found.path);
    }
    if (choice === "external") {
      adoptExternal(found.externalText);
      setStatus("外部の変更を読み込みました");
      return;
    }
    if (choice === "mine") {
      // flush は予約が無いと何もしない（保存が一度失敗した後など）。
      // 予約の有無に関わらず、必ず今の本文を書く（レビュー 2026-09-04）
      await autosave.flush();
      if (dirtyRef.current) {
        try {
          await pendingSave.current?.();
        } catch (error) {
          setStatus(`保存に失敗: ${String(error)}`);
          return;
        }
      }
      setStatus("自分の版で上書きしました");
      return;
    }
    // 両方残す: 自分の版を競合コピーへ、このノートは外部の版に
    const mine = editorRef.current?.getText() ?? "";
    const copy = await conflictCopy(vaultRoot, found.path, mine);
    adoptExternal(found.externalText);
    await refresh();
    setStatus(`自分の版を「${noteLabel(vaultRoot, copy)}」に残しました`);
  }

  if (!vaultRoot) {
    return (
      <main className="app app-empty">
        <h1>覚書</h1>
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
        onDragEnter={(event) => {
          if (!isNoteDrag(Array.from(event.dataTransfer.types))) return;
          event.preventDefault();
        }}
        onDragOver={(event) => {
          if (!isNoteDrag(Array.from(event.dataTransfer.types))) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          // フォルダの行で受けたものはそこで処理済み。ここへ来るのは
          // 落とし先でない場所なので、静かに捨てる（本文に文字を
          // 落とさない）
          if (!isNoteDrag(Array.from(event.dataTransfer.types))) return;
          event.preventDefault();
          draggingNote.current = null;
          setDropFolder(null);
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
              <header>
                {/* 保管フォルダの変更は環境設定にある（要望 2026-09-04）。
                  同じことをする入口を一覧の上にも置かない */}
                <button onClick={() => void handleCreate()}>＋ 新規</button>
              </header>
              {/* 検索欄は一覧の絞り込みなので、一覧と一緒に出し入れする */}
              {settings.notesVisible && (
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
              )}
              {!settings.notesVisible ? null : query.trim() ? (
                <ul className="note-scroll note-rows">
                  {hits.map((hit) => (
                    <li key={hit.path}>
                      <button
                        className="search-hit"
                        onClick={() =>
                          void openNote(`${vaultRoot}/${hit.path}`)
                        }
                      >
                        <span className="hit-title">{hit.title}</span>
                        <span className="hit-snippet">{hit.snippet}</span>
                      </button>
                    </li>
                  ))}
                  {hits.length === 0 && (
                    <li className="no-hits">見つかりません</li>
                  )}
                </ul>
              ) : (
                <div className="note-scroll">
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
                  {!trashView && (
                    <div className="sort-row">
                      <select
                        value={sortOrder}
                        onChange={(event) =>
                          changeSort(event.currentTarget.value as SortOrder)
                        }
                      >
                        <option value="modified">更新順</option>
                        <option value="title">名前順</option>
                      </select>
                    </div>
                  )}
                  <ul className="note-rows">
                    {trashView && trashNotes.length === 0 && (
                      <li className="no-hits">
                        ゴミ箱は空です。捨てたノートは {settings.trashDays}{" "}
                        日残ります
                      </li>
                    )}
                    {/* 捨てたノート（要望 2026-09-05）。**出せる操作を絞る** —
                        ゴミ箱の中身にピン留めや改名を許すと、戻したときの
                        状態が読めない（参照実装 note_actions と同じ判断） */}
                    {trashView &&
                      trashNotes.map((entry) => {
                        const { name, folder } = trashParts(
                          vaultRoot,
                          entry.path,
                        );
                        return (
                          <li key={entry.path} className="trash-item">
                            <button
                              className={`trash-row${entry.path === currentPath ? " selected" : ""}`}
                              title={`${trashLabel(vaultRoot, entry.path)}（右クリックで戻す・削除）`}
                              onClick={() => void openNote(entry.path)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setTrashMenu({
                                  path: entry.path,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                            >
                              <span className="trash-name">{name}</span>
                              <span className="trash-meta">
                                {/* 元の場所。直下のノートには出さない */}
                                {folder && (
                                  <span className="trash-folder">{folder}</span>
                                )}
                                <span className="trash-stamp">
                                  {formatStamp(entry.trashedMs)}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    {!trashView &&
                      (tagFilter || folderFilter !== null) &&
                      sortedNotes.length === 0 && (
                        <li className="no-hits">
                          {tagFilter
                            ? "このタグのノートはありません"
                            : "このフォルダにノートはありません"}
                        </li>
                      )}
                    {sortedNotes.map((entry) => (
                      <li key={entry.path}>
                        <button
                          className={`note-row${entry.path === currentPath ? " selected" : ""}`}
                          // フォルダへ落として移す（要望 2026-09-04）
                          draggable
                          onDragStart={(event) => {
                            draggingNote.current = entry.path;
                            // 動かすのであって写しではない（緑の + を出さない）
                            event.dataTransfer.effectAllowed = "move";
                            // **載せるのは目印だけ。** 素の文字を載せると
                            // 本文や入力欄が「文字のコピー」として受け、
                            // 緑の + が付くうえ、落とすと題名が本文に入る
                            // （実機報告 2026-09-04）
                            event.dataTransfer.setData(
                              NOTE_DRAG_TYPE,
                              entry.path,
                            );
                            // 画面の外で作った札を絵にする。**画面に載って
                            // いないと写し取ってもらえない**ので、消すのは
                            // 掴み終わってから（dragend）
                            const ghost = document.createElement("div");
                            ghost.className = "drag-ghost";
                            ghost.textContent = noteStem(entry.path);
                            document.body.appendChild(ghost);
                            dragGhost.current = ghost;
                            event.dataTransfer.setDragImage(ghost, 12, 12);
                          }}
                          onDragEnd={() => {
                            draggingNote.current = null;
                            setDropFolder(null);
                            dragGhost.current?.remove();
                            dragGhost.current = null;
                          }}
                          onClick={() => void openNote(entry.path)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setNoteMenu({
                              path: entry.path,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <span className="note-row-title">
                            {entry.pinned && (
                              <span className="pin-mark">📌</span>
                            )}
                            {entry.label}
                          </span>
                          {entry.preview && (
                            <span className="note-row-preview">
                              {entry.preview}
                            </span>
                          )}
                          <span className="note-row-stamp">
                            {formatStamp(entry.mtimeMs)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {settings.treesVisible && searches.length > 0 && (
                <details className="search-section" open>
                  <summary>保存した検索（{searches.length}）</summary>
                  <ul>
                    {searches.map((entry) => (
                      <li key={entry.name}>
                        <button
                          className="saved-search-row"
                          title={entry.query}
                          onClick={() => {
                            // 結果は一覧ペイン側に出る。閉じたままだと
                            // 押しても無反応に見える（レビュー 2026-09-04）
                            if (!settingsRef.current.notesVisible) {
                              changeSettings({ notesVisible: true });
                            }
                            handleQueryChanged(entry.query);
                          }}
                        >
                          <span className="saved-search-name">
                            {entry.name}
                          </span>
                        </button>
                        <button
                          className="saved-search-remove"
                          title="この検索を外す"
                          onClick={() =>
                            keepSearches(removeSearch(searches, entry.name))
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {settings.treesVisible && (
                <details
                  className="folder-section"
                  open={sideOpen === "folders"}
                >
                  {/* **見出しがそのまま保管フォルダの行**（要望 2026-09-05）。
                      同じ場所を指す「直下」の行を下に並べない。三角を押すと
                      開閉、名前を押すと直下で絞る。作る操作は右クリックへ */}
                  <summary
                    // **色は見出しの行ぜんぶに敷く。** 帯の左端を中の
                    // フォルダと揃える（要望 2026-09-05）
                    className={
                      (folderFilter === "" ? "selected" : "") +
                      (dropFolder === "" ? " drop-target" : "")
                    }
                    onClick={(event) => {
                      event.preventDefault(); // 開閉はこちらで持つ（タグと排他）
                      toggleSide("folders");
                    }}
                    onDragEnter={(event) => {
                      if (!acceptsDrop(event, "")) return;
                      event.preventDefault();
                      setDropFolder("");
                    }}
                    onDragOver={(event) => {
                      if (!acceptsDrop(event, "")) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropFolder("");
                    }}
                    onDragLeave={() =>
                      setDropFolder((current) =>
                        current === "" ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      const dragged =
                        draggingNote.current ||
                        event.dataTransfer.getData(NOTE_DRAG_TYPE);
                      draggingNote.current = null;
                      setDropFolder(null);
                      if (dragged) void handleDropOnFolder(dragged, "");
                    }}
                  >
                    <span className="side-twist" aria-hidden="true" />
                    <button
                      className="folder-row folder-head"
                      title="右クリックで作る（ノートを落とすと直下へ移せます）"
                      onClick={(event) => {
                        event.preventDefault(); // summary の開閉を巻き込まない
                        event.stopPropagation();
                        filterByFolder(folderFilter === "" ? null : "");
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setFolderMenu({
                          folder: "",
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <MenuIcon name="folder" />
                      <span className="folder-name">フォルダ</span>
                      <span className="folder-count">{rootNotes}</span>
                    </button>
                  </summary>
                  <ul>
                    {subFolders.map(({ folder, count }) => (
                      // **受け口はボタンではなく行に置く。** WebKit では
                      // ボタンがドラッグの出来事を飲んでしまう。あわせて
                      // **dragenter と dragover の両方を止める** —
                      // dragover だけで受けられるのは Chrome の甘さで、
                      // WebKit はこれが無いと落とせない（実機で発覚
                      // 2026-09-04: 掴めるのに落とせない）
                      <li
                        key={folder || "."}
                        onDragEnter={(event) => {
                          if (!acceptsDrop(event, folder)) return;
                          event.preventDefault();
                          setDropFolder(folder);
                        }}
                        onDragOver={(event) => {
                          if (!acceptsDrop(event, folder)) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDropFolder(folder);
                        }}
                        onDragLeave={() =>
                          setDropFolder((current) =>
                            current === folder ? null : current,
                          )
                        }
                        onDrop={(event) => {
                          event.preventDefault();
                          const dragged =
                            draggingNote.current ||
                            event.dataTransfer.getData(NOTE_DRAG_TYPE);
                          draggingNote.current = null;
                          setDropFolder(null);
                          if (dragged) void handleDropOnFolder(dragged, folder);
                        }}
                      >
                        <button
                          className={
                            `folder-row${folder === folderFilter ? " selected" : ""}` +
                            (folder === dropFolder ? " drop-target" : "")
                          }
                          style={{
                            // **見出しより 1 段下げる**（要望 2026-09-05）。
                            // 見出しと頭が揃っていると、中のフォルダが
                            // 同じ高さのものに見える
                            paddingLeft: `${1.8 + folderDepth(folder) * 0.8}rem`,
                          }}
                          title="右クリックで作る・名前を変える・消す（ノートを落とすと移せます）"
                          onClick={() =>
                            filterByFolder(
                              folder === folderFilter ? null : folder,
                            )
                          }
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFolderMenu({
                              folder,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <MenuIcon name="folder" />
                          <span className="folder-name">
                            {folderLabel(folder)}
                          </span>
                          <span className="folder-count">{count}</span>
                        </button>
                      </li>
                    ))}
                    {/* **ゴミ箱もフォルダの中に置く**（要望 2026-09-05）。
                        押すと一覧が捨てたノートに変わる。落とし先としての
                        振る舞い（ノートを落とすと捨てる）はそのまま */}
                    <li
                      onDragEnter={(event) => {
                        if (!isNoteDrag(Array.from(event.dataTransfer.types)))
                          return;
                        event.preventDefault();
                        setDropTrash(true);
                      }}
                      onDragOver={(event) => {
                        if (!isNoteDrag(Array.from(event.dataTransfer.types)))
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTrash(true);
                      }}
                      onDragLeave={() => setDropTrash(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        const dragged =
                          draggingNote.current ||
                          event.dataTransfer.getData(NOTE_DRAG_TYPE);
                        draggingNote.current = null;
                        setDropTrash(false);
                        // ピン留めの断りと確認は handleTrash が持っている
                        if (dragged) void handleTrash(dragged);
                      }}
                    >
                      <button
                        className={
                          `folder-row${folderFilter === TRASH_FOLDER ? " selected" : ""}` +
                          (dropTrash ? " drop-target" : "")
                        }
                        // 書き始めは見出しの「フォルダ」と揃える
                        // （要望 2026-09-05）。中のフォルダより 1 段浅い
                        style={{ paddingLeft: "1.8rem" }}
                        title="捨てたノートを見る（落とすと捨てます。右クリックで空にできます）"
                        onClick={() =>
                          filterByFolder(
                            folderFilter === TRASH_FOLDER ? null : TRASH_FOLDER,
                          )
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          // path が無いときは「ゴミ箱そのもの」への操作
                          setTrashMenu({
                            path: null,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <MenuIcon name="trash" />
                        <span className="folder-name">ゴミ箱</span>
                        <span className="folder-count">
                          {trashNotes.length}
                        </span>
                      </button>
                    </li>
                  </ul>
                </details>
              )}
              {settings.treesVisible && tags.length > 0 && (
                <details className="tag-section" open={sideOpen === "tags"}>
                  <summary
                    onClick={(event) => {
                      event.preventDefault(); // 開閉はこちらで持つ（フォルダと排他）
                      toggleSide("tags");
                    }}
                  >
                    <span className="side-twist" aria-hidden="true" />
                    <MenuIcon name="tag" />
                    <span className="side-label">タグ</span>
                    <span className="side-count">{tags.length}</span>
                  </summary>
                  <ul>
                    {tags.map(({ tag, count }) => (
                      <li key={tag}>
                        <button
                          className={`tag-row${tag === tagFilter ? " selected" : ""}`}
                          title="右クリックで絞る・検索・コピー"
                          onClick={() =>
                            filterByTag(tag === tagFilter ? null : tag)
                          }
                          // **OS の既定のメニューを出さない**（要望
                          // 2026-09-04）。「Google で検索」「共有」など、
                          // 選んだ文字を外へ出す道が並んでしまう
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setTagMenu({
                              tag,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <span className="tag-name">#{tag}</span>
                          <span className="tag-count">{count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
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
          {headings !== null &&
            (() => {
              // クイックオープンと同じ絞り方（入口が増えても操作を覚え直さない）
              // 空の見出し（`##` だけの行）も選べるようにする
              const labels = headings.map(
                (item) => item.text || "（無題の見出し）",
              );
              const ranked = rankCandidates(headingQuery, labels).slice(0, 30);
              return (
                <div
                  className="palette-backdrop"
                  onMouseDown={() => setHeadings(null)}
                >
                  <div
                    className="palette"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <input
                      autoFocus
                      className="palette-input"
                      placeholder="見出しへ飛ぶ"
                      value={headingQuery}
                      onChange={(event) => {
                        setHeadingQuery(event.currentTarget.value);
                        setHeadingIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setHeadings(null);
                        else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setHeadingIndex((i) =>
                            Math.min(i + 1, ranked.length - 1),
                          );
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setHeadingIndex((i) => Math.max(i - 1, 0));
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          jumpToHeading(headings[ranked[headingIndex] ?? -1]);
                        }
                      }}
                    />
                    <ul>
                      {ranked.map((headingIdx, rankedIndex) => (
                        <li key={`${headings[headingIdx].from}`}>
                          <button
                            className={
                              rankedIndex === headingIndex ? "selected" : ""
                            }
                            // 字下げで階層を見せる（深さを数字で出しても読み取りにくい）
                            style={{
                              paddingLeft: `${0.5 + (headings[headingIdx].level - 1) * 0.9}rem`,
                            }}
                            onMouseEnter={() => setHeadingIndex(rankedIndex)}
                            onClick={() => jumpToHeading(headings[headingIdx])}
                          >
                            {labels[headingIdx]}
                          </button>
                        </li>
                      ))}
                      {ranked.length === 0 && (
                        <li className="no-hits">見つかりません</li>
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}
          {quickOpen &&
            (() => {
              const labels = notes.map((entry) => entry.label);
              const ranked = rankCandidates(paletteQuery, labels).slice(0, 20);
              const choose = (rankedIndex: number) => {
                const noteIndex = ranked[rankedIndex];
                if (noteIndex === undefined) return;
                setQuickOpen(false);
                void openNote(notes[noteIndex].path);
              };
              return (
                <div
                  className="palette-backdrop"
                  onMouseDown={() => setQuickOpen(false)}
                >
                  <div
                    className="palette"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <input
                      autoFocus
                      className="palette-input"
                      placeholder="ノート名で開く"
                      value={paletteQuery}
                      onChange={(event) => {
                        setPaletteQuery(event.currentTarget.value);
                        setPaletteIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setQuickOpen(false);
                        else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setPaletteIndex((i) =>
                            Math.min(i + 1, ranked.length - 1),
                          );
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setPaletteIndex((i) => Math.max(i - 1, 0));
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          choose(paletteIndex);
                        }
                      }}
                    />
                    <ul>
                      {ranked.map((noteIndex, rankedIndex) => (
                        <li key={notes[noteIndex].path}>
                          <button
                            className={
                              rankedIndex === paletteIndex ? "selected" : ""
                            }
                            onMouseEnter={() => setPaletteIndex(rankedIndex)}
                            onClick={() => choose(rankedIndex)}
                          >
                            {labels[noteIndex]}
                          </button>
                        </li>
                      ))}
                      {ranked.length === 0 && (
                        <li className="no-hits">見つかりません</li>
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}
          <section className="editor-pane">
            {doc !== null && currentPath !== null ? (
              <>
                {/* 題名の行は本文と同じ幅で中央に置くので、区切り線は
                  外側の帯に引く（線だけが短いと途中で切れて見える） */}
                <div className="note-header-bar">
                  <header className="note-header">
                    <input
                      key={currentPath}
                      className="title-input"
                      defaultValue={noteStem(currentPath)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          // 改名は onBlur に一本化する（ここでも呼ぶと二重発火）
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={(event) =>
                        void handleRename(event.currentTarget.value)
                      }
                    />
                  </header>
                  {/* 操作はアイコンでペインの右端に寄せる（題名の 46rem 幅とは
                    独立。ユーザー要望 2026-09-04）。並びは
                    ピン → 書き出し → 履歴 → ゴミ箱 → ソース表示切替 */}
                  <div
                    className="note-actions"
                    role="group"
                    aria-label="ノートの操作"
                  >
                    {(() => {
                      const pinned = notes.find(
                        (entry) => entry.path === currentPath,
                      )?.pinned;
                      return (
                        <button
                          className={pinned ? "selected" : ""}
                          title={
                            pinned
                              ? "ピンを外す"
                              : "ピン留め（一覧の先頭に固定）"
                          }
                          aria-pressed={pinned}
                          onClick={() => void handlePin()}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M9.5 2 14 6.5l-3 1-2.5 4.5L4 7.5 8.5 5l1-3Z"
                              fill={pinned ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M6 10 2.5 13.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      );
                    })()}
                    <button
                      title="HTML に書き出し"
                      onClick={() => void handleExport()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M8 10V2.5M5 5l3-3 3 3M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button title="版の履歴" onClick={() => void openHistory()}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <circle
                          cx="8"
                          cy="8"
                          r="5.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                        />
                        <path
                          d="M8 5v3.2l2.2 1.4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <button
                      title="ゴミ箱へ移動"
                      onClick={() => void handleTrash()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8M6.7 7v4M9.3 7v4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      className={sourceMode ? "selected" : ""}
                      title={
                        sourceMode
                          ? "通常表示に戻す（Cmd+/）"
                          : "ソース表示（Cmd+/）"
                      }
                      aria-pressed={sourceMode}
                      onClick={() =>
                        editorRef.current?.setSourceMode(!sourceMode)
                      }
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* 書式ツールバー（B-1）。ショートカットを覚えていなくても
                  押せるようにする。**アイコンだけ**なので、呼び名と
                  ショートカットは Tips（title）が担う */}
                <div
                  className="format-toolbar"
                  role="toolbar"
                  aria-label="書式"
                >
                  {FORMAT_TOOLBAR.map((group, index) => (
                    <Fragment key={group[0].kind}>
                      {index > 0 && (
                        <span
                          className="toolbar-separator"
                          aria-hidden="true"
                        />
                      )}
                      {group.map((item) => (
                        <button
                          key={item.kind}
                          title={formatHint(item)}
                          aria-label={item.label}
                          // **押しても本文の選択を外さない。** 外すと囲む
                          // ものが無くなって空振りする（参照実装が
                          // NoFocus で守っていたのと同じ勘所）
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            item.kind === "table"
                              ? setTableDialog(true)
                              : editorRef.current?.applyFormat(item.kind)
                          }
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            {item.paths.map((d) => (
                              <path
                                key={d}
                                d={d}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            ))}
                          </svg>
                        </button>
                      ))}
                    </Fragment>
                  ))}
                </div>
                <Editor
                  key={currentPath}
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
              <details className="backlink-bar">
                <summary>バックリンク（{backlinks.length}）</summary>
                <ul>
                  {backlinks.map((entry) => (
                    <li key={entry.path}>
                      <button
                        onClick={() =>
                          void openNote(`${vaultRoot}/${entry.path}`)
                        }
                      >
                        <span className="backlink-title">
                          {entry.title}
                          {/* 続柄（M-3）。付いているものだけ出す */}
                          {entry.relation && (
                            <span className="backlink-relation">
                              {entry.relation}
                            </span>
                          )}
                        </span>
                        <span className="backlink-context">
                          {entry.context}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {templates !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setTemplates(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTemplates(null);
                  else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setTemplateIndex((i) =>
                      Math.min(i + 1, templates.length - 1),
                    );
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setTemplateIndex((i) => Math.max(i - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const chosen = templates[templateIndex];
                    if (chosen) void handleCreateFromTemplate(chosen);
                  }
                }}
              >
                <header className="palette-title">テンプレートを選ぶ</header>
                <ul>
                  {templates.map((path, index) => (
                    <li key={path}>
                      <button
                        autoFocus={index === 0}
                        className={index === templateIndex ? "selected" : ""}
                        onMouseEnter={() => setTemplateIndex(index)}
                        onClick={() => void handleCreateFromTemplate(path)}
                      >
                        {noteStem(path)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {folderDialog !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setFolderDialog(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">
                  {folderDialog.kind === "create"
                    ? folderDialog.folder
                      ? `「${folderDialog.folder}」の中に新しいフォルダ`
                      : "新しいフォルダ"
                    : `「${folderDialog.folder}」の名前を変更`}
                </header>
                <div className="table-dialog-fields">
                  <label>
                    名前
                    <input
                      ref={folderName}
                      autoFocus
                      defaultValue={
                        folderDialog.kind === "rename"
                          ? folderLabel(folderDialog.folder)
                          : ""
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void confirmFolderName();
                        else if (event.key === "Escape") setFolderDialog(null);
                      }}
                    />
                  </label>
                </div>
                <div className="dialog-actions">
                  <button onClick={() => setFolderDialog(null)}>やめる</button>
                  <button
                    className="primary"
                    onClick={() => void confirmFolderName()}
                  >
                    決定
                  </button>
                </div>
              </div>
            </div>
          )}
          {moveOpen && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setMoveOpen(false)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">フォルダへ移動</header>
                <ul>
                  {folders.map(({ folder }) => (
                    <li key={folder || "."}>
                      <button
                        style={{
                          paddingLeft: `${0.5 + folderDepth(folder) * 0.8}rem`,
                        }}
                        onClick={() => void handleMoveNote(folder)}
                      >
                        {folderLabel(folder)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {preferences && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setPreferences(false)}
            >
              <div
                className="palette preferences"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">環境設定</header>
                <div
                  className="pref-tabs"
                  role="tablist"
                  aria-label="設定のページ"
                >
                  <button
                    role="tab"
                    aria-selected={prefTab === "general"}
                    className={prefTab === "general" ? "selected" : ""}
                    onClick={() => setPrefTab("general")}
                  >
                    一般
                  </button>
                  <button
                    role="tab"
                    aria-selected={prefTab === "assistant"}
                    className={prefTab === "assistant" ? "selected" : ""}
                    onClick={() => setPrefTab("assistant")}
                  >
                    アシスタント
                  </button>
                </div>
                {prefTab === "general" ? (
                  <div className="pref-page">
                    <h3 className="pref-section">本文の見え方</h3>
                    <p className="pref-note">
                      エディタに出る文字の形と幅。開いているノートにすぐ反映されます。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>本文フォント</span>
                        <input
                          list="body-fonts"
                          value={settings.bodyFont}
                          placeholder="システムの既定"
                          onChange={(event) =>
                            changeSettings({
                              bodyFont: event.currentTarget.value,
                            })
                          }
                        />
                        <datalist id="body-fonts">
                          {bodyFontChoices.map((font) => (
                            <option
                              key={font.family}
                              value={font.family}
                              label={font.label}
                            />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span>文字サイズ</span>
                        <span className="pref-unit-row">
                          <input
                            type="number"
                            min={MIN_FONT_PX}
                            max={MAX_FONT_PX}
                            value={fontSize}
                            onChange={(event) =>
                              changeFontSize(Number(event.currentTarget.value))
                            }
                          />
                          <span className="pref-unit">px</span>
                        </span>
                      </label>
                      <label>
                        {/* 等幅に限らない（要望 2026-09-04）。ここが効くのは
                          コード・数式・Mermaid のソースで、桁を空白で
                          揃えるのをやめた（ADR-0044）ので等幅である必要は
                          もう無い。呼び名も中身に合わせる */}
                        <span>コード・数式のフォント</span>
                        <input
                          list="mono-fonts"
                          value={settings.monoFont}
                          placeholder="既定の等幅"
                          onChange={(event) =>
                            changeSettings({
                              monoFont: event.currentTarget.value,
                            })
                          }
                        />
                        <datalist id="mono-fonts">
                          {codeFontChoices.map((font) => (
                            <option
                              key={font.family}
                              value={font.family}
                              label={font.label}
                            />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span>本文の幅</span>
                        <select
                          value={settings.contentWidth}
                          onChange={(event) =>
                            changeSettings({
                              contentWidth: event.currentTarget
                                .value as ContentWidth,
                            })
                          }
                        >
                          {CONTENT_WIDTHS.map((width) => (
                            <option key={width} value={width}>
                              {WIDTH_LABELS[width]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>タブ幅</span>
                        <span className="pref-unit-row">
                          <select
                            value={settings.tabWidth}
                            onChange={(event) =>
                              changeSettings({
                                tabWidth: Number(event.currentTarget.value),
                              })
                            }
                          >
                            {TAB_WIDTHS.map((width) => (
                              <option key={width} value={width}>
                                {width}
                              </option>
                            ))}
                          </select>
                          <span className="pref-unit">文字</span>
                        </span>
                      </label>
                      <label>
                        <span>字下げ</span>
                        <span className="pref-check">
                          <input
                            type="checkbox"
                            checked={settings.indentedCode}
                            onChange={(event) =>
                              changeSettings({
                                indentedCode: event.currentTarget.checked,
                              })
                            }
                          />
                          4 文字の字下げでコードブロックとする
                        </span>
                      </label>
                    </div>
                    <h3 className="pref-section">ウィンドウ</h3>
                    <p className="pref-note">
                      アプリ全体の配色と、一覧やサイドバーの詰まり具合。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>テーマ</span>
                        <select
                          value={settings.theme}
                          onChange={(event) =>
                            changeSettings({
                              theme: event.currentTarget.value as Theme,
                            })
                          }
                        >
                          {THEMES.map((theme) => (
                            <option key={theme} value={theme}>
                              {THEME_LABELS[theme]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>行間</span>
                        <select
                          value={settings.lineSpacing}
                          onChange={(event) =>
                            changeSettings({
                              lineSpacing: event.currentTarget
                                .value as LineSpacing,
                            })
                          }
                        >
                          {LINE_SPACINGS.map((spacing) => (
                            <option key={spacing} value={spacing}>
                              {SPACING_LABELS[spacing]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <h3 className="pref-section">ノートの置き場所</h3>
                    <p className="pref-note">
                      .md
                      ファイルを読み書きするフォルダ。変えても中のファイルは移動しません。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>保管フォルダ</span>
                        <span className="pref-vault-row">
                          <input value={vaultRoot ?? ""} readOnly />
                          <button onClick={() => void chooseVault()}>
                            変更…
                          </button>
                        </span>
                      </label>
                      <label>
                        <span>ゴミ箱の保持</span>
                        <span className="pref-unit-row">
                          <input
                            type="number"
                            min={MIN_TRASH_DAYS}
                            max={MAX_TRASH_DAYS}
                            value={settings.trashDays}
                            onChange={(event) =>
                              changeSettings({
                                trashDays: Number(event.currentTarget.value),
                              })
                            }
                          />
                          <span className="pref-unit">日</span>
                        </span>
                      </label>
                      <label>
                        <span>履歴を残す間隔</span>
                        <select
                          value={settings.historyMinutes}
                          onChange={(event) =>
                            changeSettings({
                              historyMinutes: Number(event.currentTarget.value),
                            })
                          }
                        >
                          {HISTORY_CHOICES.map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {minutes === 0 ? "なし" : `${minutes} 分`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>履歴の使用量</span>
                        <span className="pref-static">
                          {historyUsage === null
                            ? "計算中…"
                            : formatBytes(historyUsage)}
                        </span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="pref-page">
                    <h3 className="pref-section">アシスタント</h3>
                    {/* **数字や記号で説明しない**（要望 2026-09-04）。
                      127.0.0.1 と書いても伝わらない。約束の中身
                      （外へ出ない）は変えず、言い方だけ変える */}
                    {/* **一番上に置く**（要望 2026-09-04）。切ってあるときは
                      以下を丸ごと押せなくし、Cmd+6 でも出さない */}
                    <label className="pref-check pref-toggle">
                      <input
                        type="checkbox"
                        checked={settings.assistantEnabled}
                        onChange={(event) =>
                          changeSettings({
                            assistantEnabled: event.currentTarget.checked,
                          })
                        }
                      />
                      AI アシスタントを使う
                    </label>
                    <p className="pref-note">
                      Ollama に繋いで、要約やレビューを頼みます。やり取りは
                      このパソコンの中だけで行われ、ノートは外へ出ません。
                    </p>
                    {/* **まとめて押せなくする。** 1 つずつ disabled を付けると、
                      あとで足した欄に付け忘れる */}
                    <fieldset
                      className="preferences-fields"
                      disabled={!settings.assistantEnabled}
                    >
                      <label>
                        <span>モデル</span>
                        <span className="pref-unit-row">
                          <input
                            value={settings.llmModel}
                            placeholder="gemma3:4b"
                            list="llm-model-choices"
                            onChange={(event) =>
                              changeSettings({
                                llmModel: event.currentTarget.value,
                              })
                            }
                          />
                          <datalist id="llm-model-choices">
                            {installedModels.map((model) => (
                              <option key={model} value={model} />
                            ))}
                          </datalist>
                          {installedModels.length > 0 &&
                          !installedModels.includes(settings.llmModel) ? (
                            <span className="pref-unit">
                              （Ollama に入っていません）
                            </span>
                          ) : null}
                        </span>
                      </label>
                      <label>
                        <span>ポート</span>
                        <span className="pref-unit-row">
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={settings.llmPort}
                            onChange={(event) =>
                              changeSettings({
                                llmPort: Number(event.currentTarget.value),
                              })
                            }
                          />
                          <span className="pref-unit">
                            （このパソコンの中だけ）
                          </span>
                        </span>
                      </label>
                      <label>
                        <span>一度に渡す量</span>
                        <select
                          value={settings.llmContext}
                          onChange={(event) =>
                            changeSettings({
                              llmContext: Number(event.currentTarget.value),
                            })
                          }
                        >
                          {CONTEXT_CHOICES.map((tokens) => (
                            <option key={tokens} value={tokens}>
                              {tokens / 1024}k トークン
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>応答待ち時間</span>
                        <span className="pref-unit-row">
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={settings.llmTimeoutMinutes}
                            onChange={(event) =>
                              changeSettings({
                                llmTimeoutMinutes: Number(
                                  event.currentTarget.value,
                                ),
                              })
                            }
                          />
                          <span className="pref-unit">分</span>
                        </span>
                      </label>
                      <label>
                        <span>モデルを残す時間</span>
                        <select
                          value={settings.llmKeepAlive}
                          onChange={(event) =>
                            changeSettings({
                              llmKeepAlive: event.currentTarget.value,
                            })
                          }
                        >
                          {KEEP_ALIVE_CHOICES.map((value) => (
                            <option key={value} value={value}>
                              {value === "0"
                                ? "すぐ降ろす"
                                : value.replace("m", " 分")}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                    <h3 className="pref-section">外のサービス</h3>
                    <p className="pref-note">
                      本文を右クリックして選んだところを、外の生成 AI や Google
                      へ渡せます。**渡すのは選んだところだけ**で、
                      押したときしか出ません。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>渡す前の確認</span>
                        <span className="pref-check">
                          <input
                            type="checkbox"
                            checked={settings.confirmHandoff}
                            onChange={(event) =>
                              changeSettings({
                                confirmHandoff: event.currentTarget.checked,
                              })
                            }
                          />
                          生成AIにデータを渡すときは確認する
                        </span>
                      </label>
                    </div>
                    <h3 className="pref-section">PowerPoint</h3>
                    <p className="pref-note">
                      書き出すスライドの配色と書体を、選んだテンプレートに
                      合わせます（背景の飾りやロゴは入りません）。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>テンプレート</span>
                        <span className="pref-vault-row">
                          <input
                            value={settings.slideTemplate}
                            readOnly
                            placeholder="選んでいません（既定の見た目）"
                          />
                          <button onClick={() => void chooseSlideTemplate()}>
                            選ぶ…
                          </button>
                          {settings.slideTemplate && (
                            <button
                              onClick={() =>
                                changeSettings({ slideTemplate: "" })
                              }
                            >
                              外す
                            </button>
                          )}
                        </span>
                      </label>
                    </div>
                    <h3 className="pref-section">画像とPDF</h3>
                    <p className="pref-note">
                      取り込んだ画像や PDF
                      から、絵の中の文字を起こすときに使うもの。
                    </p>
                    <div className="preferences-fields">
                      <label>
                        <span>文字の読み取り</span>
                        <select value="mac" onChange={() => {}}>
                          <option value="mac">macOS（デフォルト）</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
                <div className="pref-actions">
                  <button onClick={resetPreferences}>デフォルトに戻す</button>
                  <span className="pref-actions-right">
                    <button onClick={cancelPreferences}>キャンセル</button>
                    <button
                      className="primary"
                      onClick={() => setPreferences(false)}
                    >
                      OK
                    </button>
                  </span>
                </div>
              </div>
            </div>
          )}
          {tableDialog && (
            <div
              className="palette-backdrop"
              onClick={() => setTableDialog(false)}
            >
              <div
                className="palette"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="palette-title">表を挿入</header>
                <div className="table-dialog-fields">
                  <label>
                    行（見出しを除く）
                    <input
                      ref={tableRows}
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={2}
                    />
                  </label>
                  <label>
                    列
                    <input
                      ref={tableColumns}
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={2}
                    />
                  </label>
                </div>
                <div className="dialog-actions">
                  <button onClick={() => setTableDialog(false)}>やめる</button>
                  <button className="primary" onClick={confirmInsertTable}>
                    挿入
                  </button>
                </div>
              </div>
            </div>
          )}
          {recovery > 0 && (
            <div className="palette-backdrop">
              <div className="palette">
                <header className="palette-title">
                  保存されていない変更が見つかりました
                </header>
                <p className="dialog-text">
                  前回終了したときに保存されていない変更が {recovery}{" "}
                  件あります。
                  別のファイルとして復元しますか？（今あるノートは書き換えません）
                </p>
                <div className="conflict-actions">
                  <button onClick={() => void handleRecovery(false)}>
                    復元しない
                  </button>
                  <button onClick={() => void handleRecovery(true)}>
                    復元する
                  </button>
                </div>
              </div>
            </div>
          )}
          {noteMenu !== null &&
            (() => {
              const target = noteMenu.path;
              const pinned = notes.find(
                (entry) => entry.path === target,
              )?.pinned;
              const run = (action: () => void) => () => {
                setNoteMenu(null);
                action();
              };
              return (
                <ContextMenu at={noteMenu} onClose={() => setNoteMenu(null)}>
                  <li>
                    <button onClick={run(() => void handlePin(target))}>
                      <MenuIcon name="pin" />
                      {pinned ? "ピンを外す" : "ピン留め"}
                    </button>
                  </li>
                  <li>
                    {/* **本文を入れ替える「開く」とは別の道**（U-1）。
                        書いているノートを奪わずに、もう 1 枚を並べる */}
                    <button onClick={run(() => void openBeside(target))}>
                      <MenuIcon name="beside" />
                      横に開く
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void handleDuplicate(target))}>
                      <MenuIcon name="copy" />
                      複製
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={run(() => {
                        setMoveTarget(target);
                        setMoveOpen(true);
                      })}
                    >
                      <MenuIcon name="move" />
                      フォルダへ移動…
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => setTemplateName(target))}>
                      <MenuIcon name="template" />
                      テンプレートに登録…
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button onClick={run(() => void copyNoteLink(target))}>
                      <MenuIcon name="link" />
                      リンクをコピー
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void revealItemInDir(target))}>
                      <MenuIcon name="finder" />
                      Finder で表示
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    {/* 項目ごと消すと理由が分からない。押せない状態で見せる */}
                    <button
                      className="danger"
                      disabled={pinned}
                      title={
                        pinned ? "ピン留め中は捨てられません" : "ゴミ箱へ移動"
                      }
                      onClick={run(() => void handleTrash(target))}
                    >
                      <MenuIcon name="trash" />
                      ゴミ箱へ移動
                    </button>
                  </li>
                </ContextMenu>
              );
            })()}
          {editorMenu !== null &&
            (() => {
              const selected = editorMenu.selected;
              const run = (action: () => void) => () => {
                setEditorMenu(null);
                action();
              };
              // 書式の絵は**ツールバーと同じもの**を引く（同じ言葉に同じ絵）
              const format = (kind: FormatKind, label: string) => {
                const item = FORMAT_TOOLBAR.flat().find(
                  (found) => found.kind === kind,
                );
                return (
                  <li key={kind}>
                    <button
                      onClick={run(() => editorRef.current?.applyFormat(kind))}
                    >
                      <svg
                        className="menu-icon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                      >
                        {(item?.paths ?? []).map((d) => (
                          <path
                            key={d}
                            d={d}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                      </svg>
                      {label}
                    </button>
                  </li>
                );
              };
              return (
                <ContextMenu
                  at={editorMenu}
                  onClose={() => setEditorMenu(null)}
                >
                  <li>
                    {/* 選んでいないときは押せない状態で見せる
                        （項目ごと消すと、なぜ無いのか分からない） */}
                    <button
                      disabled={!selected}
                      onClick={run(() => void editorClipboard("cut"))}
                    >
                      <MenuIcon name="cut" />
                      切り取り
                    </button>
                  </li>
                  <li>
                    <button
                      disabled={!selected}
                      onClick={run(() => void editorClipboard("copy"))}
                    >
                      <MenuIcon name="copy" />
                      コピー
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void editorClipboard("paste"))}>
                      <MenuIcon name="paste" />
                      貼り付け
                    </button>
                  </li>
                  <li className="separator" />
                  {format("strong", "太字")}
                  {format("emphasis", "斜体")}
                  {format("code", "コード")}
                  {format("link", "リンク")}
                  <li className="separator" />
                  {format("heading", "見出し")}
                  {format("bullet", "箇条書き")}
                  {format("quote", "引用")}
                  <li className="separator" />
                  <li>
                    <button onClick={run(() => setTableDialog(true))}>
                      <MenuIcon name="table" />
                      表を挿入…
                    </button>
                  </li>
                  <li className="separator" />
                  {/* **外へ出る道**（要望 2026-09-05）。生成 AI は 4 つを
                      枝にまとめる — 平らに並べるとメニューの半分を占める。
                      選んでいないときは押せない状態で見せる（渡すものが無い） */}
                  {selected ? (
                    <SubMenu
                      icon={<MenuIcon name="handoff" />}
                      label="生成AIに渡す"
                    >
                      {AI_HANDOFFS.map((handoff) => (
                        <li key={handoff.id}>
                          <button onClick={run(() => void handOff(handoff))}>
                            {handoff.name}
                          </button>
                        </li>
                      ))}
                    </SubMenu>
                  ) : (
                    <li>
                      <button disabled>
                        <MenuIcon name="handoff" />
                        生成AIに渡す
                      </button>
                    </li>
                  )}
                  <li>
                    <button
                      disabled={!selected}
                      onClick={run(() => void handOff(SEARCH_HANDOFF))}
                    >
                      <MenuIcon name="search" />
                      {SEARCH_HANDOFF.label}
                    </button>
                  </li>
                </ContextMenu>
              );
            })()}
          {gearMenu !== null &&
            (() => {
              // 参照実装（ui/menus.build_gear_menu）と同じ考え方:
              // **メニューバーと同じ動作を使い回し、よく使うものだけ**。
              // 全部の写しにすると、探す手間がメニューバーと変わらない
              const run = (action: () => void) => () => {
                setGearMenu(null);
                action();
              };
              // **印は幅を持つ枠に入れる。** 全角の空白で字下げすると、
              // JSX が行頭の空白を落として揃わない（実機報告 2026-09-04）。
              // 印と字の幅が違っても、枠が同じなら頭は揃う
              const check = (on: boolean) => (
                <span className="menu-check">{on ? "✓" : ""}</span>
              );
              const menu = menuActions.current;
              return (
                // 歯車は**押した絵の真上**に出す（測って置くのではなく、
                // 下端を歯車に合わせる = ADR は無いが lib/context-menu の
                // anchorAbove の言）
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
                    <li>
                      <button onClick={run(openPreferences)}>
                        <MenuIcon name="preferences" />
                        環境設定…
                      </button>
                    </li>
                    <li className="separator" />
                    <li>
                      <button onClick={run(() => menu["toggle-trees"]?.())}>
                        {check(settings.treesVisible)}サイドバー
                      </button>
                    </li>
                    <li>
                      <button onClick={run(() => menu["toggle-notes"]?.())}>
                        {check(settings.notesVisible)}ノート一覧
                      </button>
                    </li>
                    <li>
                      <button onClick={run(toggleOutline)}>
                        {check(outlineOpen)}アウトライン
                      </button>
                    </li>
                    {/* 使わない設定のときは並べない（押せない項目を見せない） */}
                    {settings.assistantEnabled && (
                      <li>
                        <button onClick={run(() => menu.assistant?.())}>
                          {check(assistantOpen)}アシスタント
                        </button>
                      </li>
                    )}
                    <li className="separator" />
                    <li>
                      <button onClick={run(() => menu["source-mode"]?.())}>
                        {check(sourceMode)}ソース表示
                      </button>
                    </li>
                    <li>
                      <button onClick={run(() => menu["focus-mode"]?.())}>
                        {check(false)}フォーカスモード
                      </button>
                    </li>
                    <li>
                      <button onClick={run(() => menu.typewriter?.())}>
                        {check(false)}タイプライタモード
                      </button>
                    </li>
                  </ul>
                </div>
              );
            })()}
          {tagMenu !== null &&
            (() => {
              const target = tagMenu.tag;
              const filtered = target === tagFilter;
              const run = (action: () => void) => () => {
                setTagMenu(null);
                action();
              };
              return (
                <ContextMenu at={tagMenu} onClose={() => setTagMenu(null)}>
                  <li>
                    <button
                      onClick={run(() => filterByTag(filtered ? null : target))}
                    >
                      {filtered ? "絞り込みを解除" : `#${target} で絞り込む`}
                    </button>
                  </li>
                  <li>
                    {/* 絞り込みは一覧を狭めるだけ。**本文まで見たいとき**は
                        検索へ回す（同じ書き方が検索欄でも効く） */}
                    <button onClick={run(() => searchByTag(target))}>
                      <MenuIcon name="search" />
                      このタグで全ノート検索
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button onClick={run(() => void copyTag(target))}>
                      <MenuIcon name="copy" />
                      タグ名をコピー
                    </button>
                  </li>
                </ContextMenu>
              );
            })()}
          {folderMenu !== null &&
            (() => {
              // 空文字は保管フォルダの直下（「直下」の行）。名前も変えられ
              // ないし消せないので、作る項目だけ出す
              const target = folderMenu.folder;
              const isRoot = target === "";
              const run = (action: () => void) => () => {
                setFolderMenu(null);
                action();
              };
              return (
                <ContextMenu
                  at={folderMenu}
                  onClose={() => setFolderMenu(null)}
                >
                  <li>
                    <button onClick={run(() => void handleCreate(target))}>
                      <MenuIcon name="noteNew" />
                      新規ノート
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={run(() =>
                        setFolderDialog({ kind: "create", folder: target }),
                      )}
                    >
                      <MenuIcon name="folderNew" />
                      新規フォルダ…
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void openInFinder(target))}>
                      <MenuIcon name="finder" />
                      Finder で開く
                    </button>
                  </li>
                  {!isRoot && (
                    <>
                      <li className="separator" />
                      <li>
                        <button
                          onClick={run(() =>
                            setFolderDialog({
                              kind: "rename",
                              folder: target,
                            }),
                          )}
                        >
                          <MenuIcon name="rename" />
                          名前を変更…
                        </button>
                      </li>
                      <li>
                        <button
                          className="danger"
                          onClick={run(() => void handleDeleteFolder(target))}
                        >
                          <MenuIcon name="trash" />
                          削除
                        </button>
                      </li>
                    </>
                  )}
                </ContextMenu>
              );
            })()}
          {trashMenu !== null &&
            (() => {
              const target = trashMenu.path;
              const run = (action: () => void) => () => {
                setTrashMenu(null);
                action();
              };
              return (
                <ContextMenu at={trashMenu} onClose={() => setTrashMenu(null)}>
                  <li>
                    <button
                      onClick={run(() => void openInFinder(TRASH_FOLDER))}
                    >
                      <MenuIcon name="finder" />
                      Finder で開く
                    </button>
                  </li>
                  <li className="separator" />
                  {target === null ? (
                    <li>
                      <button
                        className="danger"
                        onClick={run(() => void handleEmptyTrash())}
                      >
                        <MenuIcon name="trash" />
                        ゴミ箱を空にする…
                      </button>
                    </li>
                  ) : (
                    <>
                      <li>
                        <button onClick={run(() => void handleRestore(target))}>
                          <MenuIcon name="restore" />
                          元に戻す
                        </button>
                      </li>
                      <li className="separator" />
                      <li>
                        <button
                          className="danger"
                          onClick={run(() => void handleDeleteForever(target))}
                        >
                          <MenuIcon name="trash" />
                          完全に削除
                        </button>
                      </li>
                    </>
                  )}
                </ContextMenu>
              );
            })()}
          {styleFindings !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setStyleFindings(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">
                  文体を見る（{styleFindings.length} 件）
                </header>
                <ul>
                  {styleFindings.map((found) => (
                    <li key={`${found.start}-${found.kind}`}>
                      <button
                        onClick={() => {
                          setStyleFindings(null);
                          editorRef.current?.revealPos(found.start);
                        }}
                      >
                        <span className="style-text">
                          {(editorRef.current?.getText() ?? "").slice(
                            found.start,
                            found.start + found.length,
                          ) || "（空白）"}
                        </span>
                        {/* **どう書けるか**を出す（何が悪いかだけでは動けない） */}
                        <span className="style-message">{found.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="dialog-text">
                  指摘するだけで、直しはしません。書き換えるかどうかは
                  書いた人が決めます。
                </p>
              </div>
            </div>
          )}
          {graph !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setGraph(null)}
            >
              <div
                className="palette graph-dialog"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">リンクの図</header>
                <div
                  className="graph-canvas"
                  dangerouslySetInnerHTML={{ __html: graph.svg }}
                />
                <p className="dialog-text">
                  {/* **黙って減らさない**（上限で落ちたぶんを言う） */}
                  {graph.dropped > 0
                    ? `多いので ${graph.dropped} 件を省いています。`
                    : "開いているノートから辿れる範囲です。"}
                </p>
                <div className="conflict-actions">
                  <button
                    disabled={graphDepth <= 1}
                    onClick={() => void showLinkGraph(graphDepth - 1)}
                  >
                    狭く
                  </button>
                  <button
                    disabled={graphDepth >= 4}
                    onClick={() => void showLinkGraph(graphDepth + 1)}
                  >
                    広く（{graphDepth} 段）
                  </button>
                  <button onClick={() => setGraph(null)}>閉じる</button>
                </div>
              </div>
            </div>
          )}
          {savingSearch !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setSavingSearch(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">検索を保存</header>
                <div className="table-dialog-fields">
                  <label>
                    サイドバーに出す名前
                    <input
                      ref={searchName}
                      autoFocus
                      // 既定は式そのもの（短い式ならそのまま通せる）
                      defaultValue={savingSearch}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") confirmSaveSearch();
                        else if (event.key === "Escape") setSavingSearch(null);
                      }}
                    />
                  </label>
                </div>
                <p className="dialog-text">検索式: {savingSearch}</p>
                <div className="dialog-actions">
                  <button onClick={() => setSavingSearch(null)}>やめる</button>
                  <button className="primary" onClick={confirmSaveSearch}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
          {templateName !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setTemplateName(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">テンプレートに登録</header>
                <div className="table-dialog-fields">
                  <label>
                    名前
                    <input
                      ref={templateInput}
                      autoFocus
                      defaultValue={noteStem(templateName)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter")
                          void confirmRegisterTemplate();
                        else if (event.key === "Escape") setTemplateName(null);
                      }}
                    />
                  </label>
                </div>
                <p className="dialog-text">
                  見出しは {"{{title}}"} に置き換わります（この雛形から作った
                  ノートには新しい題名が入ります）。
                </p>
                <div className="dialog-actions">
                  <button onClick={() => setTemplateName(null)}>やめる</button>
                  <button
                    className="primary"
                    onClick={() => void confirmRegisterTemplate()}
                  >
                    登録
                  </button>
                </div>
              </div>
            </div>
          )}
          {deleted !== null && (
            <div className="palette-backdrop">
              <div className="palette">
                <header className="palette-title">
                  ファイルが削除されました
                </header>
                <p className="dialog-text">
                  「{noteStem(deleted)}」は外部で削除されました。
                  編集中の内容で作り直しますか？
                </p>
                <div className="conflict-actions">
                  <button onClick={closeDeleted}>閉じる</button>
                  <button onClick={() => void recreateDeleted()}>
                    作り直す
                  </button>
                </div>
              </div>
            </div>
          )}
          {conflict !== null && (
            <div className="palette-backdrop">
              <div className="palette">
                <header className="palette-title">
                  このノートは外部でも変更されています。どうしますか？
                </header>
                <div className="conflict-actions">
                  <button onClick={() => void resolveConflict("external")}>
                    外部の変更を採用（自分の編集を捨てる）
                  </button>
                  <button onClick={() => void resolveConflict("mine")}>
                    自分の版で上書き（外部の変更を捨てる）
                  </button>
                  <button onClick={() => void resolveConflict("both")}>
                    両方残す（自分の版を「名前 (競合 日付)」に保存）
                  </button>
                </div>
              </div>
            </div>
          )}
          {historyEntries !== null && (
            <div
              className="palette-backdrop"
              onMouseDown={() => setHistoryEntries(null)}
            >
              <div
                className="palette"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="palette-title">
                  版の履歴（新しい順・戻す前に今の内容も残ります）
                </header>
                <ul>
                  {historyEntries.map((entry) => (
                    <li key={entry.path} className="history-row">
                      <span>{entry.stamp}</span>
                      <button onClick={() => void restoreVersion(entry)}>
                        戻す
                      </button>
                    </li>
                  ))}
                  {historyEntries.length === 0 && (
                    <li className="no-hits">
                      まだ版がありません（保存から 60 分間隔で残ります）
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
          {assistantOpen && (
            <aside className="assistant-pane">
              <header>アシスタント</header>
              {/* 並びは参照実装（ui/assistant_pane.py）と同じ。
                **ボタンの列は Ollama が無くても出す** — 「関連」は索引を
                引くだけで、モデルを通さない（L-3） */}
              <div
                className="assistant-actions"
                role="group"
                aria-label="アシスタント"
              >
                {ASSISTANT_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    className={action.id === "stop" ? "assistant-stop" : ""}
                    title={action.hint}
                    aria-label={action.label}
                    disabled={
                      action.id === "stop"
                        ? !thinking
                        : action.id === "related"
                          ? // **索引を引くだけ。** Ollama が無くても押せる（L-3）
                            !currentPath
                          : thinking || !currentPath || llmReady === false
                    }
                    onClick={() => {
                      if (action.id === "stop") stopAssistant();
                      else if (action.id === "related") showRelated();
                      else void askAssistant(action.id);
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      {action.paths.map((d) => (
                        <path
                          key={d}
                          d={d}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </svg>
                  </button>
                ))}
              </div>
              {llmReady === false ? (
                // **押してから断らない**（G-3 のゴミ箱と同じ作法）
                <p className="assistant-note">
                  アシスタントを使うには Ollama という無料のソフトが要ります。
                  <br />
                  ollama.com から入れて動かすと、ここで使えるようになります。
                  <br />
                  読ませたノートはこのパソコンの中だけで扱われ、外へは出ません。
                </p>
              ) : (
                <>
                  {/* vault 全体への質問（L-2）。打って Enter が自然（検索欄と同じ） */}
                  <div className="assistant-ask">
                    <input
                      value={question}
                      placeholder="ノート全体に質問する"
                      onChange={(event) =>
                        setQuestion(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing
                        )
                          void askQuestion();
                      }}
                    />
                    {/* 空の質問では押せない（押しても何も起きないボタンを押させない） */}
                    <button
                      title={ASK_ACTION.hint}
                      aria-label={ASK_ACTION.label}
                      disabled={thinking || !question.trim()}
                      onClick={() => void askQuestion()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        {ASK_ACTION.paths.map((d) => (
                          <path
                            key={d}
                            d={d}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                      </svg>
                    </button>
                  </div>
                  {/* **答えを書き始めたら畳む**（要望 2026-09-04）。使い方の
                    案内は、まだ何も出ていないときにだけ意味がある */}
                  {!thinking && !answer && (
                    <p className="assistant-note">
                      要約とレビューはこのノートだけを読みます。質問は索引で
                      材料を探して読ませます。 本文は書き換えません。
                    </p>
                  )}
                  {/* **渡した材料をそのまま出す。** 出典を作文させない */}
                  {sources.length > 0 && (
                    <div className="related-notes">
                      <div className="related-title">読んだノート</div>
                      <ul>
                        {sources.map((hit) => (
                          <li key={hit.path}>
                            <button
                              onClick={() =>
                                void openNote(`${vaultRoot}/${hit.path}`)
                              }
                            >
                              <span className="related-name">{hit.title}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="assistant-answer">
                    {answer || (thinking ? "考えています…" : "")}
                  </div>
                </>
              )}
              {/* 関連は索引から出す。**Ollama が無くても出る**（L-3） */}
              {relatedShown && (
                <div className="related-notes">
                  <div className="related-title">関連するノート</div>
                  <ul>
                    {related.map((entry) => (
                      <li key={entry.path}>
                        <button
                          onClick={() =>
                            void openNote(`${vaultRoot}/${entry.path}`)
                          }
                        >
                          <span className="related-name">{entry.title}</span>
                          {/* **理由をそのまま出す**（読めないと確かめようがない） */}
                          <span className="related-reason">
                            {entry.reasons.join(" / ")}
                          </span>
                        </button>
                      </li>
                    ))}
                    {related.length === 0 && (
                      <li className="no-hits">
                        関連するノートはありません。タグを付けるか
                        `[[ノート名]]` で結ぶと出ます。
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </aside>
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
                indentedCode={settings.indentedCode}
              />
            </aside>
          )}
          {outlineOpen && (
            <aside className="outline-pane">
              <header>目次</header>
              <ul>
                {outlineItems.map((item, index) => (
                  <li key={`${item.from}-${item.text}`}>
                    <button
                      className={index === currentOutlineIndex ? "current" : ""}
                      style={{
                        paddingLeft: `${0.5 + (item.level - 1) * 0.9}rem`,
                      }}
                      onClick={() => editorRef.current?.revealPos(item.from)}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
                {outlineItems.length === 0 && (
                  <li className="no-hits">見出しがありません</li>
                )}
              </ul>
            </aside>
          )}
        </div>
        {/* ステータスバーはウィンドウの全幅（参照実装と同じ）。
            左端に設定の歯車 — hitofude の置き場所に合わせる */}
        <footer className="status-bar">
          <button
            className="settings-button"
            title="メニュー"
            aria-label="メニュー"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setGearMenu({ left: box.left, top: box.top });
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M12.4 8h2M11.11 11.11l1.42 1.42M8 12.4v2M4.89 11.11l-1.42 1.42M3.6 8h-2M4.89 4.89 3.47 3.47M8 3.6v-2M11.11 4.89l1.42-1.42"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle
                cx="8"
                cy="8"
                r="3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle
                cx="8"
                cy="8"
                r="1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
          <span className="status-message">{status}</span>
          <span className="status-stats">
            {currentPath !== null &&
              `${stats.characters} 文字 / ${stats.lines} 行`}
            {savedAt !== null && ` ・ 保存 ${clockOf(savedAt)}`}
          </span>
        </footer>
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
