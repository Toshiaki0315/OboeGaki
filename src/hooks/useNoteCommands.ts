// 開いているノートと、ノートに対する操作（19-4 で App.tsx から切り出した）。
// 開く・閉じる・作る（無題／雛形／日次／同梱）・改名（題名の欄と、保存のあとの
// 見出しの追従）・ゴミ箱（1 件／まとめて）・ピン・戻す・完全削除・空にする・移す。
// **文書の本文は EditorView が持つ**（T2）。ここが持つのは「開いたときの本文」
// （エディタの初期値）と、どのノートを開いているかの周りだけ。Tauri は lib/ipc 経由

import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../lib/app-name";
import { forgetLastNote, saveLastNote } from "../lib/last-vault";
import {
  confirmDialog,
  createFromTemplate,
  createNote,
  dailyNote,
  deleteForever,
  emptyTrash,
  moveNote,
  pinNote,
  placeManual,
  placeMcpManual,
  readNote,
  renameNote,
  restoreNote,
  trashNote,
} from "../lib/ipc";
import type { NoteEntry } from "../lib/note-order";
import { frontMatterRange } from "../markdown/front-matter";
import { nfcUnder, noteLabel, noteStem } from "../lib/note-path";
import {
  firstHeading,
  firstHeadingLine,
  sanitizeStem,
} from "../lib/note-title";
import { renameStatusText } from "../lib/rename-status";
import { failureText } from "../lib/run-command";
import { trashLabel } from "../lib/trash-label";
import { useLatest } from "./useLatest";

export type NoteSyncPort = {
  flush: () => Promise<void>;
  markOpened: (opened: { path: string; text: string }) => void;
  dropPending: () => void;
  adopt: (text: string) => void;
  renamed: (from: string, to: string) => void;
  /// 開いている本文の一部を差し替える（編集として扱う = 自動保存が走る）
  replaceRange: (from: number, to: number, insert: string) => void;
  /// 書き先が確定するまで自動保存の予約を止める。返り値で解除
  holdSaves: () => () => void;
};

export type NoteCommandsInput = {
  vaultRoot: string | null;
  currentPath: string | null;
  notes: readonly NoteEntry[];
  trashCount: number;
  /// 保存が済んだ時刻（見出し → ファイル名の追従の合図）
  savedAt: number | null;
  selectNote: (path: string | null) => void;
  refreshLists: () => Promise<void>;
  sync: NoteSyncPort;
  onStatus: (text: string) => void;
  /// 別のノートを開いたときの後始末（印刷用の組みを捨てるなど）
  onOpened?: () => void;
  /// 開いているノートの本文（見出しの追従が読む）。エディタが無ければ undefined
  editorText: () => string | undefined;
  /// 「＋ 新規」の置き場所（絞っているフォルダ。空文字は直下）
  defaultFolder: () => string;
  /// まとめてゴミ箱へ移したあと、一覧の複数選択を外す
  clearSelection: () => void;
  storage?: Storage;
};

export function useNoteCommands(input: NoteCommandsInput) {
  const latest = useLatest(input);
  const storage = input.storage ?? localStorage;
  const [doc, setDoc] = useState<string | null>(null);
  const [initialCursor, setInitialCursor] = useState<number | null>(null);
  // エディタを作り直す単位（openNote ごとに進む。改名では進めない）
  const [editorSession, setEditorSession] = useState(0);
  // 見出し → ファイル名の追従が見る「それまでの見出し」
  const headingRef = useRef<string | null>(null);
  // Enter とフォーカス外しの両方から呼ばれるので、二重発火を弾く
  // （1 回目の改名で旧パスが消え、2 回目が「見つからない」で落ちる）
  const renaming = useRef(false);
  // 開く操作の世代。A を押した直後に B を押すと、遅れて解決した A が勝って
  // A が開いた状態で止まっていた（レビュー 2026-09-24 / 21-3）
  const opening = useRef(0);
  // エディタが**今表示している**ノートのパス。選択を変える道（開く・改名・見出し
  // 追従・閉じる）はここを通す。見出し追従の改名が返ったとき、表示中のノートが
  // 改名前のノートでなければ選択を戻さない（21-12）。以前は開く操作の世代で
  // 比べていたが、B を押した瞬間は「開く」が世代を進めてから A を保存し、その
  // 保存が追従を起動するので、追従は進んだ後の世代を控えて門をすり抜け、B の
  // 本文が A' に保存されて A の中身が消えた
  const shown = useRef<string | null>(null);
  const status = (text: string) => latest.current.onStatus(text);

  async function openNote(given: string, cursor: number | null = null) {
    const { vaultRoot, sync, selectNote } = latest.current;
    if (!vaultRoot) return;
    // 字面を索引・監視イベントと揃える（ADR-0050）。前回のノートの記憶などに
    // NFD が残っていても、開いたあとは NFC で持つ
    const path = nfcUnder(vaultRoot, given);
    const mine = ++opening.current;
    await sync.flush(); // 前のノートの未保存分を書き切ってから切り替える
    let text: string;
    try {
      text = await readNote(vaultRoot, path);
    } catch (error) {
      if (mine !== opening.current) return;
      // 一覧と実体がずれている（外で消された等）。無反応に見せない
      status(`開けませんでした: ${String(error)}`);
      return;
    }
    if (mine !== opening.current) return; // 後から別のノートが開かれた
    shown.current = path;
    selectNote(path);
    saveLastNote(storage, vaultRoot, path); // 次回の起動で開き直す
    setInitialCursor(cursor);
    setDoc(text);
    setEditorSession((session) => session + 1); // 別のノート = 作り直す
    sync.markOpened({ path, text });
    headingRef.current = firstHeading(text);
    status("");
    latest.current.onOpened?.();
  }

  /// 選択と文書を外す（外で消された・ゴミ箱へ移した）。次回の起動でも開かない
  function closeNote() {
    shown.current = null;
    latest.current.selectNote(null);
    setDoc(null);
    forgetLastNote(storage);
  }

  /// 文書だけ外す（保管フォルダを変えたとき。選択はストアが外す）
  function clearDoc() {
    shown.current = null;
    setDoc(null);
  }

  /// 外から書き換わった本文を受け取る（ピン・置換・版の書き戻し）。
  /// 見出しの控えも揃える — 追従が「見出しが変わった」と誤認しない
  function adopt(text: string) {
    latest.current.sync.adopt(text);
    headingRef.current = firstHeading(text);
  }

  /// 新しいノート（Cmd+N・フォルダの右クリック）。フォルダを渡すとその中に
  /// 作る（空文字は直下）。渡さなければ**絞っているフォルダの中**（要望 2026-09-07）
  async function create(folder = latest.current.defaultFolder()) {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    try {
      const path = await createNote(vaultRoot, "無題", folder);
      await refreshLists();
      await openNote(path);
    } catch (error) {
      status(String(error));
    }
  }

  /// 雛形から作る。**題名は聞かない** — 雛形の名前をそのまま題名にする
  /// （題名の欄で直せば見出しも追いかける = ADR-0005）
  async function fromTemplate(template: string) {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    const made = await createFromTemplate(vaultRoot, template);
    await refreshLists();
    await openNote(made.path, made.cursor);
  }

  /// 今日のノート（Cmd+T）。あれば開くだけ、無ければ日次の雛形から作る。
  /// **日付を渡せばその日のぶん**（7-5。昨日・先週に戻れる）
  async function daily(day?: string) {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    try {
      const made = await dailyNote(vaultRoot, day);
      await refreshLists();
      await openNote(made.path, made.cursor);
    } catch (error) {
      status(String(error));
    }
  }

  /// 同梱のノート（使い方／MCP の手引き）を置いて開く。既にあるノートは消さない
  async function place(which: "manual" | "mcp") {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    const placed =
      which === "manual"
        ? await placeManual(vaultRoot)
        : await placeMcpManual(vaultRoot);
    await refreshLists();
    await openNote(placed);
  }

  /// 題名の欄からの改名。Rust が本文の見出しも書き換える（ADR-0005）
  async function rename(title: string) {
    const { vaultRoot, currentPath, sync, selectNote, refreshLists } =
      latest.current;
    if (!vaultRoot || !currentPath || renaming.current) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === noteStem(currentPath)) return;
    renaming.current = true;
    // 改名も「開く」と同じ世代に乗せる。改名の往復中に一覧で別のノートを
    // 押したら、後から解決した改名側が選択と本文を上書きしない（21-5）
    const mine = ++opening.current;
    const flushed = latest.current.editorText();
    await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    // 往復の間に打った字の自動保存は、書き先が確定するまで止める（発火すると
    // 消したはずの旧パスへ書いて旧ファイルが蘇る。21-7）
    const release = sync.holdSaves();
    try {
      const outcome = await renameNote(vaultRoot, currentPath, trimmed);
      const renamed = outcome.path;
      // **ファイルが動いた直後に予約の書き先と今のパスを付け替える**（見出しの
      // 追従と同じ手順）。往復中に打った字の自動保存が、消したはずの旧パスへ
      // 書いて旧ファイルを蘇らせていた（再レビュー 2026-09-25 / 21-6）
      sync.renamed(currentPath, renamed);
      release();
      await refreshLists();
      const text = await readNote(vaultRoot, renamed);
      if (mine !== opening.current) return; // その間に別のノートが開かれた
      shown.current = renamed;
      selectNote(renamed);
      saveLastNote(storage, vaultRoot, renamed);
      // Rust が本文の見出しも書き換えている（ADR-0005）。開いている EditorView の
      // 本文を差し替える（setDoc で作り直すと Undo とキャレットが消える = 21-4）。
      // **往復の間に打った字があれば全文は差し替えない** — 見出しの行だけを編集
      // として差し替え、打った字は自動保存に乗せる（21-5）
      const live = latest.current.editorText();
      const typedMeanwhile =
        live !== undefined && flushed !== undefined && live !== flushed;
      sync.markOpened({ path: renamed, text });
      if (typedMeanwhile) {
        const span = firstHeadingLine(live);
        const heading = firstHeadingLine(text);
        if (span && heading && span.line !== heading.line) {
          sync.replaceRange(span.from, span.to, heading.line);
        } else if (!span && heading) {
          // 見出しの無いノート: Rust は front matter の後ろに `# 題\n\n` を足して
          // いる（21-7 で揃えた）。同じ場所に差し込む。閉じ区切りに改行が無い
          // 文書では改行を先に補う（`---# 題` にしない）
          const range = frontMatterRange(live);
          const at = range?.bodyStart ?? 0;
          const glue = range && range.bodyStart === range.to ? "\n" : "";
          sync.replaceRange(at, at, `${glue}${heading.line}\n\n`);
        }
      } else {
        sync.adopt(text);
      }
      headingRef.current = firstHeading(text);
      status(renameStatusText(outcome));
    } catch (error) {
      status(failureText("改名", error));
    } finally {
      release(); // 失敗しても予約は解く（2 度呼んでも害は無い）
      renaming.current = false;
    }
  }

  // ---- 見出し → ファイル名（ADR-0005 追記、要望 2026-09-10）。保存が済んだ
  // あとに、本文の H1 が変わっていたらファイル名を追わせる。**ファイル名が
  // それまでの見出しに従っていたときだけ**動かす — Finder で意図して別名を
  // 付けたノートを保存のたびに改名しない（参照実装 _rename_if_title_changed）。
  // 見出しの無いノートはファイル名に従っているとみなす（無題に H1 を書けば
  // その名前になる）
  async function followHeading() {
    const { vaultRoot, currentPath, sync, selectNote, refreshLists } =
      latest.current;
    if (!vaultRoot || !currentPath || renaming.current) return;
    const text = latest.current.editorText();
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
      status(renameStatusText(outcome));
      // 本文はそのまま（エディタを作り直さない = キャレットが飛ばない）。
      // 予約の書き先と今のパスだけ付け替える
      sync.renamed(currentPath, renamed);
      // 往復の間に別のノートが表示されていたら、選択を戻さない。戻すとエディタは
      // 別のノートの本文のまま選択だけ A' になり、次の打鍵でその本文が A' に
      // 保存されて A の中身が消える（21-11 / 21-12）
      if (shown.current !== currentPath) {
        await refreshLists(); // 動いたことだけ一覧に映す
        return;
      }
      shown.current = renamed;
      selectNote(renamed);
      saveLastNote(storage, vaultRoot, renamed);
      await refreshLists();
    } catch (error) {
      status(failureText("見出しに合わせて改名", error));
    } finally {
      renaming.current = false;
    }
  }
  const followHeadingRef = useLatest(followHeading);
  useEffect(() => {
    if (input.savedAt === null) return;
    void followHeadingRef.current();
  }, [input.savedAt, followHeadingRef]);

  /// ゴミ箱へ（開いているノート、または名指し）。ピン留め中は削除ガード（spec §7.3）
  async function trash(target?: string) {
    const { vaultRoot, currentPath, notes, sync, refreshLists } =
      latest.current;
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    // Rust 側も拒むが、確認を出す前にここで止めるほうが親切
    if (notes.find((entry) => entry.path === path)?.pinned) {
      status("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirmDialog(
      `「${noteLabel(vaultRoot, path)}」をゴミ箱へ移しますか？`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    // 捨てるのが開いているノートなら、保存予約も破棄する
    if (path === currentPath) sync.dropPending();
    try {
      await trashNote(vaultRoot, path);
    } catch (error) {
      status(String(error));
      return;
    }
    await refreshLists();
    if (path === currentPath) closeNote();
    status("");
  }

  /// 複数のノートをまとめてゴミ箱へ（一覧の複数選択をゴミ箱へ落とした）。
  /// 確認は 1 回。ピン留めは外して知らせる（spec §7.3）
  async function trashMany(paths: string[]) {
    const {
      vaultRoot,
      currentPath,
      notes,
      sync,
      refreshLists,
      clearSelection,
    } = latest.current;
    if (!vaultRoot) return;
    if (paths.length === 1) {
      await trash(paths[0]);
      return;
    }
    const pinned = paths.filter(
      (path) => notes.find((entry) => entry.path === path)?.pinned,
    );
    const targets = paths.filter((path) => !pinned.includes(path));
    if (targets.length === 0) {
      status("ピン留め中のノートはゴミ箱へ移せません（先にピンを外す）");
      return;
    }
    const ok = await confirmDialog(
      `${targets.length} 件のノートをゴミ箱へ移しますか？` +
        (pinned.length ? `（ピン留め中の ${pinned.length} 件は残します）` : ""),
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    const closing = currentPath !== null && targets.includes(currentPath);
    if (closing) sync.dropPending();
    const failed: string[] = [];
    for (const path of targets) {
      try {
        await trashNote(vaultRoot, path);
      } catch (error) {
        failed.push(`${noteStem(path)}: ${String(error)}`);
      }
    }
    await refreshLists();
    clearSelection();
    if (closing) closeNote();
    status(
      failed.length
        ? `${targets.length - failed.length} 件をゴミ箱へ移しました（移せなかった: ${failed.join("、")}）`
        : `${targets.length} 件をゴミ箱へ移しました`,
    );
  }

  /// ピン留めの付け外し（spec §7.3）。front matter が書き換わるので、
  /// 開いているエディタの内容も返ってきた本文で差し替える
  async function pin(target?: string) {
    const { vaultRoot, currentPath, notes, sync, refreshLists } =
      latest.current;
    const path = target ?? currentPath;
    if (!vaultRoot || !path) return;
    const current = notes.find((entry) => entry.path === path);
    await sync.flush(); // 未保存分を書き切ってから front matter を触る
    let text: string;
    try {
      text = await pinNote(vaultRoot, path, !current?.pinned);
    } catch (error) {
      status(failureText("ピン留め", error));
      return;
    }
    // 開いているノートなら、書き換わった front matter を読み直す
    if (path === currentPath) adopt(text);
    await refreshLists();
    status(current?.pinned ? "ピンを外しました" : "ピン留めしました");
  }

  /// ゴミ箱から戻して、そのまま開いて見せる
  async function restore(path: string) {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    const restored = await restoreNote(vaultRoot, path);
    await refreshLists();
    await openNote(restored);
  }

  /// 完全削除は取り返しがつかないので、必ず確認を挟む（G-3）
  async function deleteForeverAsked(path: string) {
    const { vaultRoot, refreshLists } = latest.current;
    if (!vaultRoot) return;
    const ok = await confirmDialog(
      `「${trashLabel(vaultRoot, path)}」を完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await deleteForever(vaultRoot, path);
    await refreshLists();
  }

  async function emptyTrashAsked() {
    const { vaultRoot, trashCount, refreshLists } = latest.current;
    if (!vaultRoot) return;
    const ok = await confirmDialog(
      `ゴミ箱の ${trashCount} 件をすべて完全に削除しますか？\nこの操作は取り消せません。`,
      { title: APP_NAME, kind: "warning" },
    );
    if (!ok) return;
    await emptyTrash(vaultRoot);
    await refreshLists();
  }

  /// フォルダへ移す（ADR-0024）。本文は書き換えない。移した先を開く
  async function moveTo(path: string, folder: string) {
    const { vaultRoot, sync, refreshLists } = latest.current;
    if (!vaultRoot) return;
    await sync.flush(); // 未保存分を旧パスへ書き切ってから動かす
    try {
      const moved = await moveNote(vaultRoot, path, folder);
      await refreshLists();
      await openNote(moved);
      status(folder ? `「${folder}」へ移しました` : "直下へ移しました");
    } catch (error) {
      status(String(error));
    }
  }

  return {
    doc,
    initialCursor,
    editorSession,
    openNote,
    closeNote,
    clearDoc,
    adopt,
    create,
    fromTemplate,
    daily,
    place,
    rename,
    trash,
    trashMany,
    pin,
    restore,
    deleteForever: deleteForeverAsked,
    emptyTrash: emptyTrashAsked,
    moveTo,
  };
}
