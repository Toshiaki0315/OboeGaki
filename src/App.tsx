import { useEffect, useMemo, useRef, useState } from "react";
import { ask, confirm, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { Editor, type EditorHandle } from "./editor/Editor";
import { createDebouncer } from "./lib/debounce";
import {
  createNote,
  readNote,
  renameNote,
  restoreNote,
  searchNotes,
  trashNote,
  useAppStore,
  writeNote,
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

  async function chooseVault() {
    const picked = await open({ directory: true });
    if (typeof picked === "string") {
      autosave.flush();
      await openVault(picked);
      setDoc(null);
    }
  }

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

  async function handleRename(title: string) {
    if (!vaultRoot || !currentPath) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === noteStem(currentPath)) return;
    autosave.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const renamed = await renameNote(vaultRoot, currentPath, trimmed);
      await refresh();
      const text = await readNote(vaultRoot, renamed);
      selectNote(renamed);
      setDoc(text);
    } catch (error) {
      setStatus(`改名に失敗: ${String(error)}`);
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
  }

  // アンマウント時（ウィンドウを閉じる直前の React 破棄）にも書き切る
  useEffect(() => () => autosave.flush(), [autosave]);

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
    // 競合。spec §7.5 は 3 択（外部 / 自分 / 両方残す）だが、
    // 「両方残す」は未実装なので 2 択で確認する（TODO: 競合コピーの作成）
    const useExternal = await ask(
      "このノートは外部でも変更されています。外部の変更を読み込み直しますか？\n（「いいえ」で自分の版を保存して上書きします）",
      { title: "覚書", kind: "warning" },
    );
    if (useExternal) {
      autosave.cancel();
      pendingSave.current = null;
      dirtyRef.current = false;
      editorRef.current?.replaceText(text);
      setStatus("外部の変更を読み込みました");
    } else {
      autosave.flush();
    }
  }

  if (!vaultRoot) {
    return (
      <main className="app app-empty">
        <h1>覚書</h1>
        <button onClick={() => void chooseVault()}>保管フォルダを開く</button>
      </main>
    );
  }

  return (
    <main className="app app-split">
      <aside className="note-list">
        <header>
          <button onClick={() => void handleCreate()}>＋ 新規</button>
          <button onClick={() => void chooseVault()}>フォルダ変更</button>
        </header>
        <input
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
          <ul>
            {notes.map((path) => (
              <li key={path}>
                <button
                  className={path === currentPath ? "selected" : ""}
                  onClick={() => void openNote(path)}
                >
                  {noteLabel(vaultRoot, path)}
                </button>
              </li>
            ))}
          </ul>
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
                    void handleRename(event.currentTarget.value);
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => void handleRename(event.currentTarget.value)}
              />
              <button onClick={() => void handleTrash()}>ゴミ箱へ</button>
            </header>
            <Editor
              key={currentPath}
              ref={editorRef}
              initialDoc={doc}
              onDocChanged={handleDocChanged}
            />
          </>
        ) : (
          <p className="placeholder">ノートを選んでください</p>
        )}
        <footer className="status-bar">{status}</footer>
      </section>
    </main>
  );
}

export default App;
