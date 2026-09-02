import { useEffect, useMemo, useRef, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { Editor } from "./editor/Editor";
import { createDebouncer } from "./lib/debounce";
import {
  createNote,
  readNote,
  renameNote,
  trashNote,
  useAppStore,
  writeNote,
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

function App() {
  const { vaultRoot, notes, currentPath, openVault, refresh, selectNote } =
    useAppStore();
  const [doc, setDoc] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const autosave = useMemo(() => createDebouncer(AUTOSAVE_DELAY_MS), []);
  // flush 時に「どのノートの内容か」を取り違えないよう、保存関数ごと持つ
  const pendingSave = useRef<(() => Promise<void>) | null>(null);

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

  function handleDocChanged(getText: () => string) {
    if (!vaultRoot || !currentPath) return;
    const root = vaultRoot;
    const path = currentPath;
    setStatus("未保存");
    pendingSave.current = async () => {
      await writeNote(root, path, getText());
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
