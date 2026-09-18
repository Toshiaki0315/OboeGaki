// Tauri コマンドの薄い包み。**ここは Rust を呼ぶだけ**で、状態は持たない
// （状態は stores/app のストアと、文書については EditorView）。Rust 側の
// 形（snake_case・タプル）を画面側の形（camelCase・オブジェクト）に直す
// のもここ。

import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";
import { CAPTURE_LABEL, captureUrl } from "./capture";
import type { McpHidden } from "./mcp-hidden";
import type { MenuChecks } from "./menu-checks";
import { listen } from "@tauri-apps/api/event";
import type { NoteEntry } from "./note-order";
import type { OcrReader } from "./ocr";
import type { Settings } from "./settings";
import { safeSubscribe } from "./subscribe";

/// Rust の note_list が返す 1 件
export type NoteMeta = {
  path: string; // vault からの相対パス
  title: string;
  preview: string;
  mtime_ms: number;
  pinned: boolean;
};

type TrashMeta = { path: string; trashed_ms: number };
/// ゴミ箱の 1 件。**捨てた新しい順**で並んで届く（Rust 側が並べる）
export type TrashEntry = { path: string; trashedMs: number };

export type TagCount = { tag: string; count: number };
/// フォルダと**直下の**ノート件数。`folder` が空文字なら保管フォルダ直下。
export type FolderCount = { folder: string; count: number };

export function toEntry(root: string, meta: NoteMeta): NoteEntry {
  return {
    path: `${root}/${meta.path}`,
    label: meta.path.replace(/\.(md|markdown)$/i, ""),
    preview: meta.preview,
    mtimeMs: meta.mtime_ms,
    pinned: meta.pinned,
  };
}

/// 一覧の引き直しだけ（軽い）。索引の同期はしない — 同期は vault_open の
/// 背景スレッドと watcher が担い、終わると index-updated が飛んでくる
export async function fetchLists(root: string) {
  const metas = await invoke<NoteMeta[]>("note_list", { root });
  const notes: NoteEntry[] = metas.map((meta) => toEntry(root, meta));
  const tagPairs = await invoke<[string, number][]>("tag_list", { root });
  const tags: TagCount[] = tagPairs.map(([tag, count]) => ({ tag, count }));
  const folderPairs = await invoke<[string, number][]>("folder_list", { root });
  const folders: FolderCount[] = folderPairs.map(([folder, count]) => ({
    folder,
    count,
  }));
  const trashed = await invoke<TrashMeta[]>("trash_list", { root });
  const trashNotes: TrashEntry[] = trashed.map((entry) => ({
    path: entry.path,
    trashedMs: entry.trashed_ms,
  }));
  const tasks = await invoke<TaskRow[]>("task_list", { root });
  return { notes, tags, folders, trashNotes, tasks };
}

/// やること一覧の 1 行（ADR-0056）。path は vault からの相対
export type TaskRow = {
  path: string;
  line: number;
  text: string;
  due: string | null;
  mtime_ms: number;
};

/// 開いていないノートのやることを完了にする（開いているノートはエディタで書く）
export async function taskComplete(
  root: string,
  path: string,
  line: number,
): Promise<void> {
  await invoke("task_complete", { root, path, line });
}

/// レイアウト作成・監視開始・背景の索引同期を起動する。
/// `trashDays` は環境設定のゴミ箱の日数（省くと Rust 側の既定）
export async function openVaultRoot(
  root: string,
  trashDays?: number,
): Promise<void> {
  await invoke<void>("vault_open", { root, trashDays });
}

/// vault にノートが 1 つも無いか（ディスクを見る）。起動時に無題を作るか
/// の判断（lib/startup-note）
export async function vaultIsEmpty(root: string): Promise<boolean> {
  return invoke<boolean>("vault_is_empty", { root });
}

/// そのノートが今もあるか。改名・ゴミ箱移動の途中でも「消えた」は届くので、
/// **本当に無いときだけ**聞くために確かめる（spec §7.5）。
export async function noteExists(root: string, path: string): Promise<boolean> {
  return invoke<boolean>("note_exists", { root, path });
}

export async function readNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_read", { root, path });
}

export async function writeNote(
  root: string,
  path: string,
  text: string,
  historyMinutes?: number,
): Promise<void> {
  await invoke("note_write", { root, path, text, historyMinutes });
}

/// 新しいノートを作る。`folder`（vault からの相対）を渡すとその中に作る。
export async function createNote(
  root: string,
  title: string,
  folder?: string,
): Promise<string> {
  return invoke<string>("note_create", { root, title, folder });
}

/// 改名の結果。`rewritten` は `[[リンク]]` を書き換えた他のノートの数
/// （ADR-0053）、`failed` は書き換えられなかったノートの名前
export type RenameOutcome = {
  path: string;
  rewritten: number;
  failed: string[];
};

export async function renameNote(
  root: string,
  path: string,
  title: string,
): Promise<RenameOutcome> {
  return invoke<RenameOutcome>("note_rename", { root, path, title });
}

export async function trashNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_trash", { root, path });
}

export async function restoreNote(root: string, path: string): Promise<string> {
  return invoke<string>("note_restore", { root, path });
}

/// ピン留めの付け外し。書き換え後の本文が返る（エディタが差し替える）。
export async function pinNote(
  root: string,
  path: string,
  pinned: boolean,
): Promise<string> {
  return invoke<string>("note_pin", { root, path, pinned });
}

/// ゴミ箱の 1 件を完全に消す。消してよいかの確認は呼び出し側の仕事。
export async function deleteForever(root: string, path: string): Promise<void> {
  await invoke("trash_delete", { root, path });
}

/// ゴミ箱を空にする。確認は呼び出し側の仕事。
export async function emptyTrash(root: string): Promise<void> {
  await invoke("trash_empty", { root });
}

/// そのタグ（と配下のタグ）が付いたノートだけ。サイドバーのタグクリックは
/// 全文検索ではなくこれで絞る（C-4。`#work` の検索が「#workshop」と
/// 書いただけのノートまで拾うのを避ける）。
export async function notesWithTag(
  root: string,
  tag: string,
): Promise<NoteEntry[]> {
  const metas = await invoke<NoteMeta[]>("notes_with_tag", { root, tag });
  return metas.map((meta) => toEntry(root, meta));
}

/// 作ったばかりのノート。cursor は `{{cursor}}` があった位置
/// （UTF-16 コード単位 = CM6 のオフセット）。
export type NewNote = { path: string; cursor: number | null };

/// `templates/` にある雛形（絶対パス。名前順）。
export async function templateList(root: string): Promise<string[]> {
  return invoke<string[]>("template_list", { root });
}

/// 雛形から新しいノートを作る（E-4）。題名は雛形の名前になる。
export async function createFromTemplate(
  root: string,
  template: string,
): Promise<NewNote> {
  return invoke<NewNote>("note_create_from_template", {
    root,
    template,
    title: "",
  });
}

/// 今日のノート。無ければ日次の雛形から作る（E-4）。
/// その日のノート。`day`（`YYYY-MM-DD`）を渡すとその日のぶん（7-5）。
export async function dailyNote(root: string, day?: string): Promise<NewNote> {
  return invoke<NewNote>("note_daily", { root, day });
}

/// 使い方のノートを今の内容で置き直す。置いた場所を返す。
export async function placeManual(root: string): Promise<string> {
  return invoke<string>("manual_place", { root });
}

/// メニューの印（✓）を今の状態に合わせる。**決めるのは画面側**（T2）で、
/// Rust は言われたとおりに付け外しする
export async function setMenuChecks(state: MenuChecks): Promise<void> {
  return invoke("menu_checks", { state });
}

/// Claude に渡さない場所（`.mcp-ignore` に書いたもの + 最初から見せない場所）。
export async function mcpHidden(root: string): Promise<McpHidden> {
  return invoke<McpHidden>("mcp_hidden", { root });
}

/// 「Claude に渡さない」を付け外しする。付け外したあとの一覧を返す。
export async function setMcpHidden(
  root: string,
  path: string,
  hidden: boolean,
): Promise<McpHidden> {
  return invoke<McpHidden>("mcp_set_hidden", { root, path, hidden });
}

/// Claude Desktop の設定に貼る JSON 断片（10-6）。バイナリと保管フォルダの
/// 場所はアプリ側が知っている — 手で打たせない
export async function mcpConfig(root: string): Promise<string> {
  return invoke<string>("mcp_config", { root });
}

/// MCP の手引きのノートを置く。置いた場所を返す。
export async function placeMcpManual(root: string): Promise<string> {
  return invoke<string>("mcp_manual_place", { root });
}

/// そのフォルダ**直下**のノート（ADR-0024 追記 4。子孫は含めない）。
export async function notesInFolder(
  root: string,
  folder: string,
): Promise<NoteEntry[]> {
  const metas = await invoke<NoteMeta[]>("notes_in_folder", { root, folder });
  return metas.map((meta) => toEntry(root, meta));
}

export async function createFolder(
  root: string,
  folder: string,
): Promise<string> {
  return invoke<string>("folder_create", { root, folder });
}

/// フォルダの名前を変える。新しい相対パスが返る。
/// フォルダを別のフォルダの中へ移す（空文字は直下）。移した先の相対パス
export async function moveFolder(
  root: string,
  folder: string,
  into: string,
): Promise<string> {
  return invoke<string>("folder_move", { root, folder, into });
}

export async function renameFolder(
  root: string,
  folder: string,
  name: string,
): Promise<string> {
  return invoke<string>("folder_rename", { root, folder, name });
}

/// フォルダを消す。ノートが入っていると Rust 側が断る。
export async function deleteFolder(
  root: string,
  folder: string,
): Promise<void> {
  await invoke("folder_delete", { root, folder });
}

/// ノートをフォルダへ移す。移した先の絶対パスが返る。
export async function moveNote(
  root: string,
  path: string,
  folder: string,
): Promise<string> {
  return invoke<string>("note_move", { root, path, folder });
}

/// このノートを `[[…]]` で指しているノート（E-6）。
/// `context` は指している**行そのもの**。
export type Backlink = {
  path: string;
  title: string;
  context: string;
  /// 続柄（M-3）。付いていなければ空。
  relation: string;
};

export async function noteBacklinks(
  root: string,
  title: string,
): Promise<Backlink[]> {
  return invoke<Backlink[]>("note_backlinks", { root, title });
}

/// 前回の未保存内容（クラッシュ退避）。`stashedAtMs` は退避した時刻。
export type Stashed = {
  source: string;
  text: string;
  stashed_at_ms: number;
};

/// 未保存の内容を退避する（保存できないまま落ちたときの保険）。
export async function stashNote(
  root: string,
  path: string,
  text: string,
): Promise<void> {
  await invoke("recovery_stash", { root, path, text });
}

export async function discardStash(root: string, path: string): Promise<void> {
  await invoke("recovery_discard", { root, path });
}

export async function pendingRecovery(root: string): Promise<Stashed[]> {
  return invoke<Stashed[]>("recovery_pending", { root });
}

/// 退避を別ファイルとして書き出す。書いた場所が返る。
export async function restoreRecovery(root: string): Promise<string[]> {
  return invoke<string[]>("recovery_restore", { root });
}

export async function clearRecovery(root: string): Promise<void> {
  await invoke("recovery_clear", { root });
}

/// 走査の結果（M-6）。「何も起きなかった」と「壊れている」を分けるために
/// 何件動いたかを返す。
export type SyncResult = { added: number; updated: number; removed: number };

/// ファイルと索引を手で合わせ直す。始めたら true、走査中なら false。
/// 終わりは "index-synced" イベントで届く。
export async function syncIndex(root: string, full: boolean): Promise<boolean> {
  return invoke<boolean>("index_sync", { root, full });
}

/// ノートを複製する。作った先の絶対パスが返る。
export async function duplicateNote(
  root: string,
  path: string,
): Promise<string> {
  return invoke<string>("note_duplicate", { root, path });
}

/// ノートを雛形として登録する。置いた場所が返る。
export async function registerTemplate(
  root: string,
  path: string,
  name: string,
): Promise<string> {
  return invoke<string>("template_register", { root, path, name });
}

/// どのノートからも指されていない添付（E-5）。
export async function unusedAttachments(root: string): Promise<string[]> {
  return invoke<string[]>("attachments_unused", { root });
}

/// 添付をゴミ箱へ移す。移した数が返る。
export async function trashAttachments(
  root: string,
  paths: string[],
): Promise<number> {
  return invoke<number>("attachments_trash", { root, paths });
}

/// 関連するノート（L-3）。**モデルは通さない**ので、Ollama が無くても出る。
export type RelatedNote = {
  /// vault からの相対パス
  path: string;
  title: string;
  /// 出た理由（そのまま画面に出す）
  reasons: string[];
};

export async function noteRelated(
  root: string,
  path: string,
  title: string,
): Promise<RelatedNote[]> {
  return invoke<RelatedNote[]>("note_related", { root, path, title });
}

/// リンクの図の素材（M-2）。`[指すノートの題名, 指し先, 続柄]`。
export async function linkMap(
  root: string,
): Promise<[string, string, string][]> {
  return invoke<[string, string, string][]>("link_map", { root });
}

export type SearchHit = {
  /** vault からの相対パス */
  path: string;
  title: string;
  snippet: string;
};

/// 検索の結果。`unreadable` は日付として読めなかった `after:` / `before:`
/// （探すのはやめないが、書き方が違うことは画面に出す）。
export type SearchOutcome = { hits: SearchHit[]; unreadable: string[] };

export async function searchNotes(
  root: string,
  query: string,
): Promise<SearchOutcome> {
  return invoke<SearchOutcome>("note_search", { root, query });
}

/// 貼り付け・ドロップの画像を attachments/ へ保存し、本文へ挿す
/// Markdown（`![](attachments/…)`）を返す。
export async function saveAttachment(
  root: string,
  data: Uint8Array,
  name: string,
): Promise<string> {
  // Tauri の JSON 経路で運ぶため base64 にする（チャンクで組んで
  // スタック溢れを避ける — spread で一気に渡すと大きい画像で落ちる）
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return invoke<string>("attachment_save", {
    root,
    data: btoa(binary),
    suffix: name,
  });
}

/// 競合の「両方残す」: 自分の版を競合コピーに保存し、その場所を返す。
export async function conflictCopy(
  root: string,
  path: string,
  text: string,
): Promise<string> {
  return invoke<string>("conflict_copy", { root, path, text });
}

export type HistoryEntry = { stamp: string; path: string };

export async function historyList(
  root: string,
  path: string,
): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("history_list", { root, path });
}

/// 版を書き戻す。返り値は書き戻したあとの本文。
/// 版の本文を読む（差分表示。書き戻さない = ADR-0054）
export async function historyRead(
  root: string,
  path: string,
  version: string,
): Promise<string> {
  return invoke<string>("history_read", { root, path, version });
}

export async function historyRestore(
  root: string,
  path: string,
  version: string,
): Promise<string> {
  return invoke<string>("history_restore", { root, path, version });
}

// 画像の data URL キャッシュ。装飾は再計算のたびに widget を作り直すので、
// invoke の往復を毎回払わない（参照実装 image_cache の役目）
const imageCache = new Map<string, Promise<string | null>>();

export function imageSource(root: string, url: string): Promise<string | null> {
  if (/^(https?:|data:)/i.test(url)) return Promise.resolve(null); // 遠隔は描かない
  const cleaned = decodeURIComponent(url.replace(/^file:\/\//, ""));
  const key = `${root}\n${cleaned}`;
  let entry = imageCache.get(key);
  if (!entry) {
    entry = invoke<string>("image_read", { root, path: cleaned }).catch(() => {
      // 失敗は覚えない。参照切れの画像を後から置いても再起動まで描かれない
      // （棚卸し 2026-09-17）
      imageCache.delete(key);
      return null;
    });
    imageCache.set(key, entry);
  }
  return entry;
}

// ---- Ollama（アシスタント）。繋ぐのは Rust 側（llm.rs）で、WebView から
// 外へは出ない。

/// 生成に渡す設定（環境設定のうち LLM の項）
export type LlmSettings = Pick<
  Settings,
  "llmPort" | "llmModel" | "llmContext" | "llmTimeoutMinutes" | "llmKeepAlive"
>;

/// 生成の注文。要約・レビュー・質問で送るものは違っても、形は 1 つ
export type LlmOrder = {
  task: string;
  title: string;
  body: string;
  question?: string;
  /// 質問の材料（題名と本文の組）
  sources?: [string, string][];
};

/// Ollama が動いているか
export function llmAvailable(port: number): Promise<boolean> {
  return invoke<boolean>("llm_available", { port });
}

/// 生成を始める。始められたら true（走っている途中なら false）
export function llmGenerate(
  settings: LlmSettings,
  order: LlmOrder,
): Promise<boolean> {
  // Rust 側は 1 つの構造体（GenerateRequest）で受ける
  return invoke<boolean>("llm_generate", {
    request: {
      port: settings.llmPort,
      model: settings.llmModel,
      context: settings.llmContext,
      timeoutMinutes: settings.llmTimeoutMinutes,
      keepAlive: settings.llmKeepAlive,
      ...order,
    },
  });
}

/// 走っている生成を止める（L-1）。止める操作で落ちないよう、失敗は飲む
export async function llmStop(): Promise<void> {
  try {
    await invoke("llm_stop");
  } catch {
    // 既に終わっていた・繋がっていない。どちらも「止まっている」
  }
}

/// モデルが載っているか（載っていなければ最初の 1 文字まで数分かかる）
export function llmLoaded(port: number, model: string): Promise<boolean> {
  return invoke<boolean>("llm_loaded", { port, model });
}

/// モデルを降ろす。降ろせたら true（生成中なら false）
export function llmUnload(port: number, model: string): Promise<boolean> {
  return invoke<boolean>("llm_unload", { port, model });
}

/// Ollama に入っているモデル名
export function llmModels(port: number): Promise<string[]> {
  return invoke<string[]>("llm_models", { port });
}

/// 生成の出来事を受ける。返り値で購読を外す
export function subscribeLlm(handlers: {
  onChunk: (piece: string) => void;
  onDone: () => void;
  onFailed: (reason: string) => void;
}): () => void {
  const stops = [
    safeSubscribe(() =>
      listen<string>("llm-chunk", (event) => handlers.onChunk(event.payload)),
    ),
    safeSubscribe(() => listen<string>("llm-done", () => handlers.onDone())),
    safeSubscribe(() =>
      listen<string>("llm-failed", (event) => handlers.onFailed(event.payload)),
    ),
  ];
  return () => stops.forEach((stop) => stop());
}

/// 履歴フォルダの大きさ（バイト）
export function historyUsage(root: string): Promise<number> {
  return invoke<number>("history_usage", { root });
}

/// 保管フォルダの外部変更（watcher）。`kind` は "modified" / "removed" など
export type VaultChange = { path: string; kind: string };

/// 外部変更を受ける。返り値で購読を外す
export function subscribeVaultChanged(
  handler: (change: VaultChange) => void,
): () => void {
  return safeSubscribe(() =>
    listen<VaultChange>("vault-changed", (event) => handler(event.payload)),
  );
}

// ---- 文字の読み取り（OCR）。読み手（ADR-0027 決定 1）は環境設定から。

/// 画像（base64）から文字を読む。読めなければ空、Ollama が無ければ Err
export function ocrImage(data: string, reader: OcrReader): Promise<string> {
  return invoke<string>("ocr_image", { data, reader });
}

/// PDF（base64）のページ（1 始まり）を絵にして文字を読む
export function ocrPdfPage(
  data: string,
  page: number,
  reader: OcrReader,
): Promise<string> {
  return invoke<string>("ocr_pdf_page", { data, page, reader });
}

// ---- ウィンドウ

/// タイトルバーの文字を変える（要望 2026-09-10）。失敗しても本文には
/// 関係ないので、呼ぶ側は待たなくてよい
export async function setWindowTitle(title: string): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

// ---- 保管フォルダ全体の置換（ADR-0055 / 12-3）

export type ReplaceOptions = { caseSensitive: boolean; includeCode: boolean };
export type ReplaceCount = { notes: number; occurrences: number };
export type ReplaceOutcome = ReplaceCount & {
  paths: string[];
  failed: string[];
};

/// 書かずに数えるだけ（押す前に件数を見せる）
export async function replacePreview(
  root: string,
  from: string,
  options: ReplaceOptions,
): Promise<ReplaceCount> {
  return invoke<ReplaceCount>("replace_preview", {
    root,
    from,
    caseSensitive: options.caseSensitive,
    includeCode: options.includeCode,
  });
}

export async function replaceApply(
  root: string,
  from: string,
  to: string,
  options: ReplaceOptions,
): Promise<ReplaceOutcome> {
  return invoke<ReplaceOutcome>("replace_apply", {
    root,
    from,
    to,
    caseSensitive: options.caseSensitive,
    includeCode: options.includeCode,
  });
}

/// タグの改名・統合（ADR-0055 / 12-4）。統合かどうかの判断と確認はフロント
export async function renameTag(
  root: string,
  from: string,
  to: string,
): Promise<ReplaceOutcome> {
  return invoke<ReplaceOutcome>("tag_rename", { root, from, to });
}

/// 今日のノートの末尾に追記（どこからでも書き取り = ADR-0057）。置いた
/// ノートのパスを返す
export async function appendDaily(root: string, text: string): Promise<string> {
  return invoke<string>("note_append_daily", { root, text });
}

// ---- どこからでも書き取りの窓（ADR-0057）。プラグインは動的 import で
// 読む（Tauri の外 = 素のブラウザでは読めない）。hook や部品はここを通す
// （ADR-0049。直接 import すると差し替えて試せない）

/// OS のグローバルショートカットを登録し、押されたら `onPressed`
export async function registerGlobalShortcut(
  key: string,
  onPressed: () => void,
): Promise<void> {
  const { register } = await import("@tauri-apps/plugin-global-shortcut");
  await register(key, (event) => {
    if (event.state === "Pressed") onPressed();
  });
}

export async function unregisterGlobalShortcut(key: string): Promise<void> {
  const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
  await unregister(key);
}

/// 書き取りの窓を出す（既にあれば前へ）
export async function openCaptureWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CAPTURE_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(CAPTURE_LABEL, {
    url: captureUrl(),
    title: "書き取り",
    width: 520,
    height: 260,
    minWidth: 320,
    minHeight: 160,
    center: true,
    alwaysOnTop: true,
    focus: true,
  });
}

/// 今いる窓を閉じる（書き取りの窓が送ったあと）
export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

// ---- 書き出し・取り込み・OS の窓（19-4）。App.tsx が直接呼んでいた 17 か所を
//      ここに寄せた（ADR-0049: 画面側は Tauri を知らない。hooks に切り出すとき
//      「hook が Tauri を直接呼ぶ」にならないための前提）

/// 書き出したファイルを置く（文字）
export function exportWrite(path: string, text: string): Promise<void> {
  return invoke("export_write", { path, text });
}

/// 書き出したファイルを置く（base64 の中身。Word / PowerPoint）
export function exportWriteBinary(path: string, data: string): Promise<void> {
  return invoke("export_write_binary", { path, data });
}

/// 取り込むファイルを読む（base64。上限は Rust 側）
export function importRead(path: string): Promise<string> {
  return invoke<string>("import_read", { path });
}

/// PDF のページ数（pdf.js が 1 ページも返さない PDF の保険。ADR-0027 追記）
export function pdfPageCount(data: string): Promise<number> {
  return invoke<number>("pdf_page_count", { data });
}

/// 印刷パネルを出す（ADR-0038）
export function printPage(): Promise<void> {
  return invoke("print_page", {});
}

/// 既定の保管フォルダ（無ければ作る場所。ADR-0032）
export function defaultVault(): Promise<string> {
  return invoke<string>("default_vault", {});
}

/// Finder で開く。**開ける先は保管フォルダの中だけ**（中かどうかは Rust が確かめる）
export function openInFinder(root: string, path: string): Promise<void> {
  return invoke("open_in_finder", { root, path });
}

/// 外のアプリの URL スキーム／辞書を開く（許した綴りだけ。Rust が見る）
export function openHandoffUrl(url: string): Promise<void> {
  return invoke("open_handoff_url", { url });
}

/// 外のアプリを名前で開く（許した名前だけ。Rust が見る）
export function openHandoffApp(app: string): Promise<void> {
  return invoke("open_handoff_app", { app });
}

/// 起動 → UI マウントの実測（spec §6.6）
export function startupElapsedMs(): Promise<number> {
  return invoke<number>("startup_elapsed_ms", {});
}

/// 背景の索引同期が終わった知らせ
export function subscribeIndexUpdated(handler: () => void): () => void {
  return safeSubscribe(() => listen("index-updated", () => handler()));
}

/// 走査の結果（M-6）。`full` は全部を見直したか
export function subscribeIndexSynced(
  handler: (full: boolean, result: SyncResult) => void,
): () => void {
  return safeSubscribe(() =>
    listen<[boolean, SyncResult]>("index-synced", (event) =>
      handler(event.payload[0], event.payload[1]),
    ),
  );
}

/// 索引の同期の失敗（理由の文）
export function subscribeIndexSyncFailed(
  handler: (message: string) => void,
): () => void {
  return safeSubscribe(() =>
    listen<string>("index-sync-failed", (event) => handler(event.payload)),
  );
}

/// ネイティブのメニューが押された（項目の id）
export function subscribeMenu(handler: (id: string) => void): () => void {
  return safeSubscribe(() =>
    listen<string>("menu", (event) => handler(event.payload)),
  );
}

/// 確認の窓（OK なら true）
export function confirmDialog(
  message: string,
  options?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<boolean> {
  return confirm(message, options);
}

export type FileFilter = { name: string; extensions: string[] };

/// ファイルを 1 つ選ぶ。選ばなければ null
export async function pickFile(options: {
  filters?: FileFilter[];
}): Promise<string | null> {
  const picked = await open({ multiple: false, ...options });
  return typeof picked === "string" ? picked : null;
}

/// フォルダを 1 つ選ぶ。選ばなければ null
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true });
  return typeof picked === "string" ? picked : null;
}

/// 保存先を選ぶ。やめれば null
export function saveTo(options: {
  defaultPath?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  return save(options);
}

/// 既定のブラウザで開く
export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}

/// Finder でファイルを見せる
export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path);
}

/// クリップボード。**Rust 側から触る** — WebView の `navigator.clipboard.readText()`
/// は許可が下りず、貼り付けが動かなかった（実機報告 2026-09-04）
export function readClipboardText(): Promise<string> {
  return readClipboard();
}

export function writeClipboardText(text: string): Promise<void> {
  return writeClipboard(text);
}
