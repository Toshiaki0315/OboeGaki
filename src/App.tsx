import {
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
import { Editor, type EditorHandle } from "./editor/Editor";
import type { Activation } from "./editor/activation";
import type { OutlineItem } from "./editor/outline";
import type { TextStats } from "./editor/stats";
import {
  collectMermaid,
  renderMermaid,
  type MermaidTheme,
} from "./editor/mermaid";
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
import { buildPptx } from "./lib/pptx";
import { readPptx, slidesToMarkdown } from "./lib/pptx-import";
import { toMarkdown } from "./lib/imported";
import { OCR_THRESHOLD, pdfPageImage, pdfPages } from "./lib/pdf-import";
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
  contentWidthCss,
  CONTENT_WIDTHS,
  HISTORY_CHOICES,
  KEEP_ALIVE_CHOICES,
  loadSettings,
  MAX_TRASH_DAYS,
  MIN_TRASH_DAYS,
  resolveTheme,
  saveSettings,
  THEMES,
  type ContentWidth,
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

const WIDTH_LABELS: Record<ContentWidth, string> = {
  standard: "標準",
  wide: "広め",
  full: "最大（ウィンドウ幅）",
};

/// ローカルLLM の断りを、画面に出す言葉にする（ADR-0025 追記）。
/// **動いているのに「動いているか確かめて」は嘘になる**ので、時間切れは
/// 別の言葉にする。
function llmErrorText(code: string, minutes: number): string {
  if (code.startsWith("not-running")) {
    return "Ollama が動いていません。`ollama serve` で動かすか、https://ollama.com から入れてください。";
  }
  if (code.startsWith("timed-out")) {
    return `${minutes} 分待っても答えが返りませんでした。大きいモデルは読み込みだけで数分かかります（設定で延ばせます）。`;
  }
  return `答えを受け取れませんでした: ${code}`;
}

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

function trashLabel(root: string, path: string): string {
  const prefix = `${root}/.trash/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return relative.replace(/\.(md|markdown)$/i, "");
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
      saveSettings(localStorage, settingsRef.current);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function changeSettings(next: Partial<Settings>) {
    setSettings((current) => {
      const merged = { ...current, ...next };
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
      // **元の場所にはリンクだけ残す**（書いた文は新しいノートへ移った）
      editorRef.current?.replaceSelection(found.link);
      autosave.flush();
      await refresh();
      setStatus(`「${found.title}」に切り出しました`);
    } catch (error) {
      setStatus(`切り出せませんでした: ${String(error)}`);
    }
  }

  async function handleDuplicate(path: string) {
    if (!vaultRoot) return;
    autosave.flush(); // 打ちかけを書き切ってから写す
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
      await navigator.clipboard.writeText(link);
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
  async function handlePrint() {
    if (!vaultRoot || !currentPath) return;
    autosave.flush();
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
    autosave.flush();
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    const target = await save({
      defaultPath: `${title}.pptx`,
      filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
    });
    if (!target) return;
    setStatus("PowerPoint を組んでいます…");
    try {
      const data = await buildPptx(splitDeck(text), (url) =>
        imageSource(vaultRoot, url),
      );
      await invoke("export_write_binary", { path: target, data });
      setStatus(`書き出しました: ${target}`);
    } catch (error) {
      setStatus(`書き出せませんでした: ${String(error)}`);
    }
  }

  /// PDF のページを読む。**文字が取れないページだけ**読み取りに回す
  /// （ADR-0027 追記: 切り分けはページごと）。
  async function readPdfPages(bytes: Uint8Array): Promise<string[]> {
    const pages = await pdfPages(bytes);
    const found: string[] = [];
    for (const [index, page] of pages.entries()) {
      if (page.trim().length >= OCR_THRESHOLD) {
        found.push(page); // 速くて正確なほうを黙って捨てない
        continue;
      }
      setStatus(`文字を読み取っています… ${index + 1}/${pages.length} ページ`);
      const image = await pdfPageImage(bytes, index + 1);
      const read = image
        ? await invoke<string>("ocr_image", { data: image })
        : "";
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
        markdown = toMarkdown(await readPdfPages(bytes), title);
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
    autosave.flush();
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
    autosave.flush(); // 未保存分を書き切ってから一覧を出す
    setHistoryEntries(await historyList(vaultRoot, currentPath));
  }

  async function restoreVersion(entry: HistoryEntry) {
    if (!vaultRoot || !currentPath) return;
    const ok = await confirm(
      `${entry.stamp} の版に戻しますか？\n（今の内容も履歴に残ります）`,
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    const text = await historyRestore(vaultRoot, currentPath, entry.path);
    autosave.cancel();
    pendingSave.current = null;
    dirtyRef.current = false;
    editorRef.current?.replaceText(text);
    setHistoryEntries(null);
    setStatus(`${entry.stamp} の版に戻しました`);
  }

  // アウトライン（Cmd+5、ADR-0022）。既定では出さず、開閉の状態は残す
  const [outlineOpen, setOutlineOpen] = useState(() => {
    try {
      return localStorage.getItem("oboegaki.outline") === "1";
    } catch {
      return false;
    }
  });
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
    setOutlineOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("oboegaki.outline", next ? "1" : "0");
      } catch {
        // 保存できなくても開閉自体は生かす
      }
      return next;
    });
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
    autosave.flush();
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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);

  // 関連するノート（L-3）。**モデルは通さない**ので、Ollama が無くても出る
  const [related, setRelated] = useState<RelatedNote[]>([]);

  // 開いているノートが変わったら引き直す（索引が更新されたときも）
  useEffect(() => {
    if (!assistantOpen || !vaultRoot || !currentPath) {
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
  }, [assistantOpen, vaultRoot, currentPath, notes]);

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
    const chunks = listen<string>("llm-chunk", (event) => {
      setAnswer((current) => current + event.payload);
    });
    const done = listen<string>("llm-done", () => setThinking(false));
    const failed = listen<string>("llm-failed", (event) => {
      setThinking(false);
      setAnswer(
        llmErrorText(event.payload, settingsRef.current.llmTimeoutMinutes),
      );
    });
    return () => {
      void chunks.then((stop) => stop());
      void done.then((stop) => stop());
      void failed.then((stop) => stop());
    };
  }, []);

  /// ノートを読ませる。**本文は書き換えない**（答えは横に出すだけ）。
  async function askAssistant(task: string) {
    if (!vaultRoot || !currentPath) return;
    autosave.flush(); // 打ちかけを書き切ってから読ませる
    const text = editorRef.current?.getText() ?? "";
    setAnswer("");
    setThinking(true);
    const started = await invoke<boolean>("llm_generate", {
      port: settings.llmPort,
      model: settings.llmModel,
      task,
      title: noteStem(currentPath),
      body: text,
      context: settings.llmContext,
      timeoutMinutes: settings.llmTimeoutMinutes,
      keepAlive: settings.llmKeepAlive,
    });
    if (!started) {
      setThinking(false);
      setAnswer("いま考えています。終わるまでお待ちください。");
      return;
    }
    // 載っていなければ読み込みから（6 分の沈黙は壊れて見える）
    const loaded = await invoke<boolean>("llm_loaded", {
      port: settings.llmPort,
      model: settings.llmModel,
    });
    if (!loaded) setAnswer("モデルを読み込んでいます…");
  }

  async function handleUnloadModel() {
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

  // 前回の vault を開き直す（TASKS 1-1）。開けなければ黙って選択画面のまま
  useEffect(() => {
    if (vaultRootRef.current) return;
    const days = settingsRef.current.trashDays;
    void restoreLastVault(localStorage, (root) => openVault(root, days)).catch(
      (error) => {
        // 別の窓が同じ vault を開いている（記憶は消さない）
        setStatus(vaultErrorText(error));
      },
    );
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
    autosave.flush(); // 前のノートの未保存分を書き切ってから切り替える
    const text = await readNote(vaultRoot, path);
    selectNote(path);
    setInitialCursor(cursor);
    setDoc(text);
    dirtyRef.current = false;
    setStatus("");
    setSavedAt(null);
    setPrintBody(null); // 前のノートの印刷用の組みは捨てる（ADR-0038）
  }

  async function handleCreate() {
    if (!vaultRoot) return;
    const path = await createNote(vaultRoot, "無題");
    await refresh();
    await openNote(path);
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
          autosave.flush();
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

  /// 開いているノートをフォルダへ移す（ADR-0024）。本文は書き換えない。
  async function handleMoveNote(folder: string) {
    // 右クリックからは開いていないノートも動かす
    const path = moveTarget ?? currentPath;
    if (!vaultRoot || !path) return;
    setMoveOpen(false);
    setMoveTarget(null);
    autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
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
    autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
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
    autosave.flush(); // 未保存分を書き切ってから front matter を触る
    const text = await pinNote(vaultRoot, path, !current?.pinned);
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
      void searchNotes(root, next).then((outcome) => {
        setHits(outcome.hits);
        // 読めない日付を黙って絞りに使わない。0 件になった理由が
        // 画面から読めないと、打ち間違いに気づけない
        setStatus(
          outcome.unreadable.length > 0
            ? `日付として読めません: ${outcome.unreadable.join(" ")}（例: after:2026-09-03）`
            : "",
        );
      });
    });
  }

  /// タグで一覧を絞る（null で解除）。検索とは排他。
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
    if (!vaultRoot || folderFilter === null) {
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
      dirtyRef.current = false;
      setStatus("保存済み");
      setSavedAt(Date.now());
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
    autosave.schedule(() => {
      void pendingSave.current?.().catch((error) => {
        setStatus(`保存に失敗: ${String(error)}`);
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
  useEffect(() => () => autosave.flush(), [autosave]);

  // グローバルショートカット（spec §5.4）。ハンドラは一度だけ登録し、
  // 最新の状態は ref 経由で読む
  function applyZoom(action: "in" | "out" | "reset") {
    if (action === "reset") changeFontSize(DEFAULT_FONT_PX);
    else
      changeFontSize(
        fontSizeRef.current + (action === "in" ? FONT_STEP_PX : -FONT_STEP_PX),
      );
  }
  const shortcutActions = useRef({
    create: handleCreate,
    flushSave: () => autosave.flush(),
    zoom: applyZoom,
  });
  shortcutActions.current = {
    create: handleCreate,
    flushSave: () => autosave.flush(),
    zoom: applyZoom,
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        setQuickOpen((open) => !open);
        setPaletteQuery("");
        setPaletteIndex(0);
      } else if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        void shortcutActions.current.create();
      } else if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        shortcutActions.current.flushSave(); // 自動保存があるので実質フラッシュ
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault(); // 全ノート検索（Cmd+Shift+F）
        searchInputRef.current?.focus();
      } else if (key === "5" && !event.shiftKey) {
        event.preventDefault(); // アウトライン開閉（ADR-0022）
        toggleOutline();
      } else {
        // 文字サイズ（TASKS 1-5）。JIS 配列で正しく効くよう event.key で見る
        const zoom = zoomActionFor(event.key, event.shiftKey);
        if (zoom) {
          event.preventDefault();
          shortcutActions.current.zoom(zoom);
        }
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
    preferences: () => setPreferences(true),
    "open-vault": () => void chooseVault(),
    resync: () => void handleSync(false),
    "rebuild-index": () => void handleSync(true),
    "cleanup-attachments": () => void handleCleanupAttachments(),
    save: () => autosave.flush(),
    "export-html": () => void handleExport(),
    "export-pptx": () => void handleExportPptx(),
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
    assistant: () => setAssistantOpen((open) => !open),
    "llm-unload": () => void handleUnloadModel(),
    "heading-palette": openHeadingPalette,
    "style-check": checkStyleNow,
    "toggle-trees": () =>
      changeSettings({ treesVisible: !settingsRef.current.treesVisible }),
    "toggle-notes": () =>
      changeSettings({ notesVisible: !settingsRef.current.notesVisible }),
    "format-heading": () => editorRef.current?.applyLineFormat("heading"),
    "format-bullet": () => editorRef.current?.applyLineFormat("bullet"),
    "format-ordered": () => editorRef.current?.applyLineFormat("ordered"),
    "format-quote": () => editorRef.current?.applyLineFormat("quote"),
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
    const unlisten = listen<string>("menu", (event) => {
      menuActions.current[event.payload]?.();
    });
    return () => void unlisten.then((stop) => stop());
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
    autosave.flush();
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
    autosave.flush();
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
    const unlisten = listen<[boolean, SyncResult]>("index-synced", (event) => {
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
      void useAppStore.getState().refresh();
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("index-sync-failed", (event) => {
      setStatus(`索引の同期に失敗しました: ${event.payload}`);
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  // 背景の索引同期が終わったら一覧を引き直す（大きな vault の初回同期）
  useEffect(() => {
    const unlisten = listen("index-updated", () => {
      void useAppStore.getState().refresh();
    });
    return () => void unlisten.then((stop) => stop());
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
    const unlisten = listen<{ path: string; kind: string }>(
      "vault-changed",
      (event) => void handleExternalChange(event.payload),
    );
    return () => void unlisten.then((stop) => stop());
    // eslint 相当の依存警告は無い構成だが、意図として登録は一度だけ。
    // ハンドラが読む値はすべて ref 経由
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExternalChange(change: { path: string; kind: string }) {
    if (!vaultRootRef.current) return;
    refreshSoon.schedule(() => void useAppStore.getState().refresh());
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
    // ダイアログで聞く（ネイティブの ask は 2 択しかできない）
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
      autosave.flush(); // 自分の版で上書き保存
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
        className={
          `app app-split${outlineOpen || assistantOpen ? " with-outline" : ""}` +
          (leftVisible ? "" : " no-list")
        }
        style={
          {
            "--editor-font-px": `${fontSize}px`,
            "--content-width": contentWidthCss(settings.contentWidth),
            "--list-width": `${settings.listWidth}px`,
            "--outline-width": `${settings.outlineWidth}px`,
          } as CSSProperties
        }
      >
        {leftVisible && (
          <aside className="note-list">
            <header>
              <button onClick={() => void handleCreate()}>＋ 新規</button>
              <button onClick={() => void chooseVault()}>フォルダ変更</button>
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
              <ul>
                {hits.map((hit) => (
                  <li key={hit.path}>
                    <button
                      className="search-hit"
                      onClick={() => void openNote(`${vaultRoot}/${hit.path}`)}
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
              <>
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
                      {folderFilter || "直下"}
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
                <ul>
                  {(tagFilter || folderFilter !== null) &&
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
                          {entry.pinned && <span className="pin-mark">📌</span>}
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
              </>
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
                        onClick={() => handleQueryChanged(entry.query)}
                      >
                        <span className="saved-search-name">{entry.name}</span>
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
              <details className="folder-section" open>
                <summary>
                  フォルダ（{folders.length - 1}）
                  <button
                    className="folder-add"
                    title={
                      folderFilter
                        ? `「${folderFilter}」の中に作る`
                        : "保管フォルダの直下に作る"
                    }
                    onClick={(event) => {
                      event.preventDefault(); // summary の開閉を巻き込まない
                      setFolderDialog({
                        kind: "create",
                        folder: folderFilter ?? "",
                      });
                    }}
                  >
                    ＋
                  </button>
                </summary>
                <ul>
                  {folders.map(({ folder, count }) => (
                    <li key={folder || "."}>
                      <button
                        className={`folder-row${folder === folderFilter ? " selected" : ""}`}
                        style={{
                          paddingLeft: `${0.5 + folderDepth(folder) * 0.8}rem`,
                        }}
                        onClick={() =>
                          filterByFolder(
                            folder === folderFilter ? null : folder,
                          )
                        }
                      >
                        <span className="folder-name">
                          {folderLabel(folder)}
                        </span>
                        <span className="folder-count">{count}</span>
                      </button>
                      {folder !== "" && folder === folderFilter && (
                        <span className="folder-actions">
                          <button
                            onClick={() =>
                              setFolderDialog({ kind: "rename", folder })
                            }
                          >
                            名前を変更
                          </button>
                          <button
                            onClick={() => void handleDeleteFolder(folder)}
                          >
                            削除
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {settings.treesVisible && tags.length > 0 && (
              <details className="tag-section" open>
                <summary>タグ（{tags.length}）</summary>
                <ul>
                  {tags.map(({ tag, count }) => (
                    <li key={tag}>
                      <button
                        className={`tag-row${tag === tagFilter ? " selected" : ""}`}
                        onClick={() =>
                          filterByTag(tag === tagFilter ? null : tag)
                        }
                      >
                        <span className="tag-name">#{tag}</span>
                        <span className="tag-count">{count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {settings.treesVisible && trashNotes.length > 0 && (
              <details className="trash-section">
                <summary>ゴミ箱（{trashNotes.length}）</summary>
                <ul>
                  {trashNotes.map((path) => (
                    <li key={path} className="trash-item">
                      <span>{trashLabel(vaultRoot, path)}</span>
                      <button onClick={() => void handleRestore(path)}>
                        戻す
                      </button>
                      <button
                        className="danger"
                        title="完全に削除"
                        onClick={() => void handleDeleteForever(path)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="danger trash-empty"
                  onClick={() => void handleEmptyTrash()}
                >
                  ゴミ箱を空にする
                </button>
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
        {outlineOpen && (
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
                  {/* 通常表示 / ソース表示の切り替え（`Cmd+/` と同じもの） */}
                  <div
                    className="mode-switch"
                    role="group"
                    aria-label="表示の切り替え"
                  >
                    <button
                      className={sourceMode ? "" : "selected"}
                      title="通常表示"
                      aria-pressed={!sourceMode}
                      onClick={() => editorRef.current?.setSourceMode(false)}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h7M2.5 12.5h9"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <button
                      className={sourceMode ? "selected" : ""}
                      title="ソース表示（Cmd+/）"
                      aria-pressed={sourceMode}
                      onClick={() => editorRef.current?.setSourceMode(true)}
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
                  <button
                    onClick={() => void handlePin()}
                    title="一覧の先頭に固定"
                  >
                    {notes.find((entry) => entry.path === currentPath)?.pinned
                      ? "ピンを外す"
                      : "ピン留め"}
                  </button>
                  <button onClick={() => void handleExport()}>書き出し</button>
                  <button onClick={() => void openHistory()}>履歴</button>
                  <button onClick={() => void handleTrash()}>ゴミ箱へ</button>
                </header>
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
                      <span className="backlink-context">{entry.context}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <footer className="status-bar">
            <span className="status-message">{status}</span>
            <span className="status-stats">
              {stats.characters} 文字 / {stats.lines} 行
              {savedAt !== null && ` ・ 保存 ${clockOf(savedAt)}`}
            </span>
          </footer>
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
              <div className="conflict-actions">
                <button onClick={() => setFolderDialog(null)}>やめる</button>
                <button onClick={() => void confirmFolderName()}>決定</button>
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
                  <span>文字サイズ</span>
                  <input
                    type="number"
                    min={MIN_FONT_PX}
                    max={MAX_FONT_PX}
                    value={fontSize}
                    onChange={(event) =>
                      changeFontSize(Number(event.currentTarget.value))
                    }
                  />
                </label>
                <label>
                  <span>本文の幅</span>
                  <select
                    value={settings.contentWidth}
                    onChange={(event) =>
                      changeSettings({
                        contentWidth: event.currentTarget.value as ContentWidth,
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
                  <span>LLM のモデル</span>
                  <input
                    value={settings.llmModel}
                    placeholder="gemma3:4b"
                    onChange={(event) =>
                      changeSettings({ llmModel: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>LLM のポート</span>
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
                </label>
                <label>
                  <span>答えを待つ上限（分）</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.llmTimeoutMinutes}
                    onChange={(event) =>
                      changeSettings({
                        llmTimeoutMinutes: Number(event.currentTarget.value),
                      })
                    }
                  />
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
                <label>
                  <span>ゴミ箱の保持</span>
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
                </label>
              </div>
              <p className="dialog-text">
                ローカルLLM の**送り先は 127.0.0.1 に固定**です（ノートは
                外へ出ません）。ポートは同じ機械の別の窓口を指すだけです。
                「履歴を残す間隔」は「戻す」ために残す版の間隔です。本文の保存は
                打ち終わって 0.8 秒後で、ここでは変わりません。「なし」は
                自分で保存したときだけ残します。ゴミ箱の日数は次に保管フォルダを
                開いたときから効きます。
              </p>
              <div className="conflict-actions">
                <button onClick={() => setPreferences(false)}>閉じる</button>
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
              <div className="conflict-actions">
                <button onClick={() => setTableDialog(false)}>やめる</button>
                <button onClick={confirmInsertTable}>挿入</button>
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
                前回終了したときに保存されていない変更が {recovery} 件あります。
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
            const pinned = notes.find((entry) => entry.path === target)?.pinned;
            const run = (action: () => void) => () => {
              setNoteMenu(null);
              action();
            };
            return (
              <div
                className="menu-backdrop"
                onMouseDown={() => setNoteMenu(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setNoteMenu(null);
                }}
              >
                <ul
                  className="context-menu"
                  // 窓の端で押されても外へはみ出さない（下の行が多い）
                  style={{
                    left: Math.min(noteMenu.x, window.innerWidth - 220),
                    top: Math.min(noteMenu.y, window.innerHeight - 280),
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <li>
                    <button onClick={run(() => void handlePin(target))}>
                      {pinned ? "ピンを外す" : "ピン留め"}
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void handleDuplicate(target))}>
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
                      フォルダへ移動…
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => setTemplateName(target))}>
                      テンプレートに登録…
                    </button>
                  </li>
                  <li className="separator" />
                  <li>
                    <button onClick={run(() => void copyNoteLink(target))}>
                      リンクをコピー
                    </button>
                  </li>
                  <li>
                    <button onClick={run(() => void revealItemInDir(target))}>
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
                      ゴミ箱へ移動
                    </button>
                  </li>
                </ul>
              </div>
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
          <div className="palette-backdrop" onMouseDown={() => setGraph(null)}>
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
              <div className="conflict-actions">
                <button onClick={() => setSavingSearch(null)}>やめる</button>
                <button onClick={confirmSaveSearch}>保存</button>
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
                      if (event.key === "Enter") void confirmRegisterTemplate();
                      else if (event.key === "Escape") setTemplateName(null);
                    }}
                  />
                </label>
              </div>
              <p className="dialog-text">
                見出しは {"{{title}}"} に置き換わります（この雛形から作った
                ノートには新しい題名が入ります）。
              </p>
              <div className="conflict-actions">
                <button onClick={() => setTemplateName(null)}>やめる</button>
                <button onClick={() => void confirmRegisterTemplate()}>
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
                <button onClick={() => void recreateDeleted()}>作り直す</button>
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
            {/* 関連するノートは索引から出す。**Ollama が無くても出る** */}
            {related.length > 0 && (
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
                </ul>
              </div>
            )}
            {llmReady === false ? (
              // **押してから断らない**（G-3 のゴミ箱と同じ作法）
              <p className="assistant-note">
                ローカルLLM（Ollama）が動いていません。
                <br />
                ollama.com から入れて `ollama serve` で動かすと使えます。
                <br />
                送り先は 127.0.0.1 に固定されています（ノートは外へ出ません）。
              </p>
            ) : (
              <>
                <div className="assistant-actions">
                  <button
                    disabled={thinking || !currentPath}
                    onClick={() => void askAssistant("summary")}
                  >
                    要約
                  </button>
                  <button
                    disabled={thinking || !currentPath}
                    onClick={() => void askAssistant("review")}
                  >
                    レビュー
                  </button>
                  <button
                    disabled={thinking || !currentPath}
                    onClick={() => void askAssistant("questions")}
                  >
                    質問を出す
                  </button>
                </div>
                <p className="assistant-note">
                  このノートだけを読んで答えます（送り先は 127.0.0.1）。
                  本文は書き換えません。
                </p>
                <div className="assistant-answer">
                  {answer || (thinking ? "考えています…" : "")}
                </div>
              </>
            )}
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
