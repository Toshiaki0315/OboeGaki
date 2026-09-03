import { useEffect, useMemo, useRef, useState } from "react";
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
import { restoreLastVault, saveLastVault } from "./lib/last-vault";
import { formatStamp, sortNotes, type SortOrder } from "./lib/note-order";
import {
  conflictCopy,
  createNote,
  historyList,
  historyRestore,
  imageSource,
  readNote,
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
  const sortedNotes = useMemo(
    () => sortNotes(notes, sortOrder),
    [notes, sortOrder],
  );
  function changeSort(order: SortOrder) {
    setSortOrder(order);
    try {
      localStorage.setItem("oboegaki.sort", order);
    } catch {
      // 保存できなくても切り替え自体は生かす
    }
  }
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

  async function openNote(path: string) {
    if (!vaultRoot) return;
    autosave.flush(); // 前のノートの未保存分を書き切ってから切り替える
    const text = await readNote(vaultRoot, path);
    selectNote(path);
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
    const ok = await confirm(
      `「${noteLabel(vaultRoot, currentPath)}」をゴミ箱へ移しますか？`,
      { title: "覚書", kind: "warning" },
    );
    if (!ok) return;
    autosave.cancel(); // 捨てるノートの保存予約は破棄する
    pendingSave.current = null;
    await trashNote(vaultRoot, currentPath);
    await refresh();
    selectNote(null);
    setDoc(null);
    setStatus("");
  }

  function handleQueryChanged(next: string) {
    setQuery(next);
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

  // Cmd+クリック（ADR-0010/0011）。ノートは無ければ作る
  async function handleActivate(action: Activation) {
    const root = vaultRootRef.current;
    if (!root) return;
    if (action.kind === "link") {
      void openUrl(action.payload);
      return;
    }
    if (action.kind === "tag") {
      handleQueryChanged(`#${action.payload}`);
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
  const shortcutActions = useRef({
    create: handleCreate,
    flushSave: () => autosave.flush(),
  });
  shortcutActions.current = {
    create: handleCreate,
    flushSave: () => autosave.flush(),
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
    <main className={`app app-split${outlineOpen ? " with-outline" : ""}`}>
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
              {sortedNotes.map((entry) => (
                <li key={entry.path}>
                  <button
                    className={`note-row${entry.path === currentPath ? " selected" : ""}`}
                    onClick={() => void openNote(entry.path)}
                  >
                    <span className="note-row-title">{entry.label}</span>
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
        {tags.length > 0 && (
          <details className="tag-section" open>
            <summary>タグ（{tags.length}）</summary>
            <ul>
              {tags.map(({ tag, count }) => (
                <li key={tag}>
                  <button
                    className="tag-row"
                    onClick={() => handleQueryChanged(`#${tag}`)}
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
                </li>
              ))}
            </ul>
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
            />
          </>
        ) : (
          <p className="placeholder">ノートを選んでください</p>
        )}
        <footer className="status-bar">{status}</footer>
      </section>
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
