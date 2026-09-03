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
import { openUrl } from "@tauri-apps/plugin-opener";
import { Editor, type EditorHandle } from "./editor/Editor";
import type { Activation } from "./editor/activation";
import type { OutlineItem } from "./editor/outline";
import { createDebouncer } from "./lib/debounce";
import { renderHtml } from "./lib/export-html";
import { rankCandidates } from "./lib/fuzzy";
import {
  clampFontSize,
  DEFAULT_FONT_PX,
  FONT_STEP_PX,
  loadFontSize,
  saveFontSize,
  zoomActionFor,
} from "./lib/font-size";
import { restoreLastVault, saveLastVault } from "./lib/last-vault";
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
  createFolder,
  createFromTemplate,
  dailyNote,
  deleteFolder,
  moveNote,
  notesInFolder,
  renameFolder,
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
  type HistoryEntry,
  type SearchHit,
} from "./stores/app";
import "./App.css";

// Phase 1 の骨格 UI: フォルダを開く → ノート一覧 → 編集 → 800ms 自動保存 →
// 新規・改名・ゴミ箱。3 ペイン構成・タグ・検索（spec §5.1）は後のフェーズで載せる。

const AUTOSAVE_DELAY_MS = 800; // spec §7.4

function noteLabel(root: string, path: string): string {
  const relative = path.startsWith(root) ? path.slice(root.length + 1) : path;
  return relative.replace(/\.(md|markdown)$/i, "");
}

function noteStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(md|markdown)$/i, "");
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
  const [hits, setHits] = useState<SearchHit[]>([]);
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
  // 本文の文字サイズ（Cmd+= / Cmd+-、TASKS 1-5）。変えたら覚える
  const [fontSize, setFontSize] = useState(() => loadFontSize(localStorage));
  function changeFontSize(px: number) {
    const next = clampFontSize(px);
    setFontSize(next);
    saveFontSize(localStorage, next);
  }
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  // クイックオープン（Cmd+O、spec §5.4）
  const [quickOpen, setQuickOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  // HTML 書き出し（ADR-0007 の CM6 版）。画像は data URL に埋め込んで
  // 1 ファイルで持ち運べる形にする
  async function handleExport() {
    if (!vaultRoot || !currentPath) return;
    autosave.flush();
    const text = await readNote(vaultRoot, currentPath);
    const title = noteStem(currentPath);
    let html = renderHtml(text, title);
    const sources = new Set(
      [...html.matchAll(/<img src="([^"]+)"/g)].map((found) => found[1]),
    );
    for (const src of sources) {
      const data = await imageSource(vaultRoot, src);
      if (data) html = html.split(`src="${src}"`).join(`src="${data}"`);
    }
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
    if (typeof picked === "string") {
      autosave.flush();
      await openVault(picked);
      saveLastVault(localStorage, picked);
      setDoc(null);
    }
  }

  // 前回の vault を開き直す（TASKS 1-1）。開けなければ黙って選択画面のまま
  useEffect(() => {
    if (vaultRootRef.current) return;
    void restoreLastVault(localStorage, openVault);
    // 起動時に一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openNote(path: string, cursor: number | null = null) {
    if (!vaultRoot) return;
    autosave.flush(); // 前のノートの未保存分を書き切ってから切り替える
    const text = await readNote(vaultRoot, path);
    selectNote(path);
    setInitialCursor(cursor);
    setDoc(text);
    dirtyRef.current = false;
    setStatus("");
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
    if (!vaultRoot || !currentPath) return;
    setMoveOpen(false);
    autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const moved = await moveNote(vaultRoot, currentPath, folder);
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

  async function handleTrash() {
    if (!vaultRoot || !currentPath) return;
    // ピン留め中は削除ガード（spec §7.3）。Rust 側も拒むが、確認を
    // 出す前にここで止めるほうが親切
    if (notes.find((entry) => entry.path === currentPath)?.pinned) {
      setStatus("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirm(
      `「${noteLabel(vaultRoot, currentPath)}」をゴミ箱へ移しますか？`,
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    autosave.cancel(); // 捨てるノートの保存予約は破棄する
    pendingSave.current = null;
    try {
      await trashNote(vaultRoot, currentPath);
    } catch (error) {
      setStatus(String(error));
      return;
    }
    await refresh();
    selectNote(null);
    setDoc(null);
    setStatus("");
  }

  // ピン留めの付け外し（spec §7.3）。front matter が書き換わるので、
  // 開いているエディタの内容も返ってきた本文で差し替える
  async function handlePin() {
    if (!vaultRoot || !currentPath) return;
    const current = notes.find((entry) => entry.path === currentPath);
    autosave.flush(); // 未保存分を書き切ってから front matter を触る
    const text = await pinNote(vaultRoot, currentPath, !current?.pinned);
    dirtyRef.current = false;
    editorRef.current?.replaceText(text);
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
      void searchNotes(root, next).then(setHits);
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

  function handleDocChanged(getText: () => string) {
    if (!vaultRoot || !currentPath) return;
    const root = vaultRoot;
    const path = currentPath;
    dirtyRef.current = true;
    setStatus("未保存");
    pendingSave.current = async () => {
      await writeNote(root, path, getText());
      dirtyRef.current = false;
      setStatus("保存済み");
    };
    autosave.schedule(() => {
      void pendingSave.current?.().catch((error) => {
        setStatus(`保存に失敗: ${String(error)}`);
      });
    });
    if (outlineOpenRef.current) {
      outlineSoon.schedule(() =>
        setOutlineItems(editorRef.current?.getOutline() ?? []),
      );
    }
  }

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
    "open-vault": () => void chooseVault(),
    save: () => autosave.flush(),
    "export-html": () => void handleExport(),
    history: () => void openHistory(),
    trash: () => void handleTrash(),
    "quick-open": () => {
      setQuickOpen((open) => !open);
      setPaletteQuery("");
      setPaletteIndex(0);
    },
    "search-all": () => searchInputRef.current?.focus(),
    outline: toggleOutline,
    "format-heading": () => editorRef.current?.applyLineFormat("heading"),
    "format-bullet": () => editorRef.current?.applyLineFormat("bullet"),
    "format-ordered": () => editorRef.current?.applyLineFormat("ordered"),
    "format-quote": () => editorRef.current?.applyLineFormat("quote"),
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
      // 改名・ゴミ箱移動の途中経過でも届くので、断定はしない
      setStatus("このノートは外部で移動または削除されました");
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
  }

  // 競合ダイアログ（spec §7.5）
  const [conflict, setConflict] = useState<{
    path: string;
    externalText: string;
  } | null>(null);

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
    <main
      className={`app app-split${outlineOpen ? " with-outline" : ""}`}
      style={{ "--editor-font-px": `${fontSize}px` } as CSSProperties}
    >
      <aside className="note-list">
        <header>
          <button onClick={() => void handleCreate()}>＋ 新規</button>
          <button onClick={() => void chooseVault()}>フォルダ変更</button>
        </header>
        <input
          ref={searchInputRef}
          className="search-input"
          type="search"
          placeholder="検索"
          value={query}
          onChange={(event) => handleQueryChanged(event.currentTarget.value)}
        />
        {query.trim() ? (
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
            {hits.length === 0 && <li className="no-hits">見つかりません</li>}
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
                  >
                    <span className="note-row-title">
                      {entry.pinned && <span className="pin-mark">📌</span>}
                      {entry.label}
                    </span>
                    {entry.preview && (
                      <span className="note-row-preview">{entry.preview}</span>
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
                setFolderDialog({ kind: "create", folder: folderFilter ?? "" });
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
                    filterByFolder(folder === folderFilter ? null : folder)
                  }
                >
                  <span className="folder-name">{folderLabel(folder)}</span>
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
                    <button onClick={() => void handleDeleteFolder(folder)}>
                      削除
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
        {tags.length > 0 && (
          <details className="tag-section" open>
            <summary>タグ（{tags.length}）</summary>
            <ul>
              {tags.map(({ tag, count }) => (
                <li key={tag}>
                  <button
                    className={`tag-row${tag === tagFilter ? " selected" : ""}`}
                    onClick={() => filterByTag(tag === tagFilter ? null : tag)}
                  >
                    <span className="tag-name">#{tag}</span>
                    <span className="tag-count">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {trashNotes.length > 0 && (
          <details className="trash-section">
            <summary>ゴミ箱（{trashNotes.length}）</summary>
            <ul>
              {trashNotes.map((path) => (
                <li key={path} className="trash-item">
                  <span>{trashLabel(vaultRoot, path)}</span>
                  <button onClick={() => void handleRestore(path)}>戻す</button>
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
                onBlur={(event) => void handleRename(event.currentTarget.value)}
              />
              <button onClick={() => void handlePin()} title="一覧の先頭に固定">
                {notes.find((entry) => entry.path === currentPath)?.pinned
                  ? "ピンを外す"
                  : "ピン留め"}
              </button>
              <button onClick={() => void handleExport()}>書き出し</button>
              <button onClick={() => void openHistory()}>履歴</button>
              <button onClick={() => void handleTrash()}>ゴミ箱へ</button>
            </header>
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
              initialCursor={initialCursor}
            />
          </>
        ) : (
          <p className="placeholder">ノートを選んでください</p>
        )}
        <footer className="status-bar">{status}</footer>
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
                setTemplateIndex((i) => Math.min(i + 1, templates.length - 1));
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
      {tableDialog && (
        <div className="palette-backdrop" onClick={() => setTableDialog(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
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
      {outlineOpen && (
        <aside className="outline-pane">
          <header>目次</header>
          <ul>
            {outlineItems.map((item, index) => (
              <li key={`${item.from}-${item.text}`}>
                <button
                  className={index === currentOutlineIndex ? "current" : ""}
                  style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.9}rem` }}
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
  );
}

export default App;
