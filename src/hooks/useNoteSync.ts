// 開いているノートとファイルを揃え続ける（ADR-0049）。自動保存（spec §7.4）・
// 退避（H-1）・外部変更の取り込みと競合の 3 択（spec §7.5）・外部削除・
// 前回の未保存。本文は手（readText / replaceText）で触り、EditorView は
// 持たない（T2）。Rust への包みは lib/ipc。

import { useEffect, useMemo, useRef, useState } from "react";
import { createDebouncer } from "../lib/debounce";
import {
  clearRecovery,
  conflictCopy,
  discardStash,
  noteExists,
  pendingRecovery,
  readNote,
  restoreRecovery,
  stashNote,
  subscribeVaultChanged,
  writeNote,
} from "../lib/ipc";

const AUTOSAVE_DELAY_MS = 800; // spec §7.4
/// 退避の間隔（H-1）。打つたびに書くとディスクを叩きすぎるので間を空ける。
/// 自動保存が 800ms で走るのでここまで来ることは少ないが、**打ち続けて
/// いる間**（デバウンスが伸び続ける）と保存できない状態の保険になる
const STASH_INTERVAL_MS = 2000;
/// 外部変更のあと、一覧をまとめて引き直すまでの間
const REFRESH_DELAY_MS = 300;

export type Conflict = { path: string; externalText: string };

export type NoteSyncInput = {
  vaultRoot: string | null;
  currentPath: string | null;
  /// 履歴を残す間隔（分）。保存のたびに最新値を読む
  historyMinutes: number;
  /// 開いているノートの本文を読む / 差し替える
  readText: () => string;
  replaceText: (text: string) => void;
  onStatus: (text: string) => void;
  /// 一覧を引き直す（外部変更のあと・復元のあと）
  refreshLists: () => Promise<void>;
  /// 外部で消されたノートを閉じる（選択と文書を外す）
  onCloseNote: () => void;
  /// 前回の未保存を別ファイルにしたあと、その書いた先（1 つ目を開くなど）
  onRecovered: (written: string[]) => Promise<void>;
};

export function useNoteSync({
  vaultRoot,
  currentPath,
  historyMinutes,
  readText,
  replaceText,
  onStatus,
  refreshLists,
  onCloseNote,
  onRecovered,
}: NoteSyncInput) {
  // 一度だけ登録する購読と、非同期の後始末が読む値は ref 経由
  const vaultRootRef = useRef(vaultRoot);
  vaultRootRef.current = vaultRoot;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const historyMinutesRef = useRef(historyMinutes);
  historyMinutesRef.current = historyMinutes;
  const readTextRef = useRef(readText);
  readTextRef.current = readText;
  const replaceTextRef = useRef(replaceText);
  replaceTextRef.current = replaceText;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const refreshListsRef = useRef(refreshLists);
  refreshListsRef.current = refreshLists;

  const autosave = useMemo(() => createDebouncer(AUTOSAVE_DELAY_MS), []);
  const refreshSoon = useMemo(() => createDebouncer(REFRESH_DELAY_MS), []);
  // 予約された保存。flush が完了を待てるよう Promise を返す
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const dirty = useRef(false); // 保存されていない編集があるか
  // ディスクにあると分かっている本文（開いた・書いた・採用した）。外部変更の
  // イベントが来ても中身がこれと同じなら、外部の変更ではない — 自分の保存の
  // 残響（抑制窓 1.5 秒を過ぎて届く）や、同期ソフト（iCloud など）が
  // 上げ終わったあとにファイルを触り直したもの（実機 2026-09-09）
  const known = useRef<{ path: string; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
  function dropStash(root: string, path: string) {
    if (stashed.current.delete(path)) void discardStash(root, path);
  }

  /// 打鍵ごとに呼ぶ。未保存の印・保存の予約・間隔ごとの退避
  function noteChanged(getText: () => string) {
    const root = vaultRootRef.current;
    const path = currentPathRef.current;
    if (!root || !path) return;
    dirty.current = true;
    onStatusRef.current("未保存");
    pendingSave.current = async () => {
      const text = getText();
      await writeNote(root, path, text, historyMinutesRef.current);
      known.current = { path, text };
      // 完了する頃には別のノートが開いているかもしれない。共有の
      // dirty と表示を触るのは**今もそのノートを開いているときだけ**
      //（レビュー 2026-09-04: 取り違えると次の外部変更が「未編集」と
      // 判定され、打ったばかりの内容が静かにリロードで消える）
      if (currentPathRef.current === path) {
        dirty.current = false;
        onStatusRef.current("保存済み");
        setSavedAt(Date.now());
      }
      // 書けたので保険は要らない。**退避したときだけ**捨てに行く
      // （毎回の保存でディスクを余分に叩かない）
      dropStash(root, path);
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
          onStatusRef.current(`保存に失敗: ${String(error)}`);
        }
        // 保存できないまま落ちても書いたものを失わない（H-1）
        void keepStash(root, path, getText());
      });
    });
  }

  /// 予約を今すぐ書き切る（切り替え・書き出し・読ませる前）
  const flush = () => autosave.flush();
  /// 予約を破棄する（聞く前・戻す前）
  const cancel = () => autosave.cancel();
  /// 予約も未保存の印も捨てる（開いているノートを捨てるとき）
  function dropPending() {
    autosave.cancel();
    pendingSave.current = null;
  }
  /// ノートを開いた直後: 未編集で、保存時刻はまだ無い
  function markOpened(opened?: { path: string; text: string }) {
    dirty.current = false;
    setSavedAt(null);
    if (opened) known.current = opened;
  }
  /// 予約を捨てて本文を差し替える（版の復元・外部の採用・ピン留め）
  function adopt(text: string) {
    autosave.cancel();
    pendingSave.current = null;
    dirty.current = false;
    const path = currentPathRef.current;
    if (path) known.current = { path, text };
    replaceTextRef.current(text);
  }

  // アンマウント時（ウィンドウを閉じる直前の React 破棄）にも書き切る
  useEffect(
    () => () => {
      void autosave.flush(); // 完了は待てない（React の破棄は同期）
    },
    [autosave],
  );

  // ---- 外部変更（spec §7.5）。一覧は少し待ってまとめて更新し、開いている
  // ノートは未編集なら静かにリロード、編集中なら確認を挟む
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);

  async function handleExternalChange(change: { path: string; kind: string }) {
    const root = vaultRootRef.current;
    if (!root) return;
    refreshSoon.schedule(() =>
      refreshListsRef
        .current()
        .catch((error) =>
          onStatusRef.current(`一覧を更新できませんでした: ${String(error)}`),
        ),
    );
    if (change.path !== currentPathRef.current) return;
    if (change.kind === "removed") {
      // 改名・ゴミ箱移動の途中経過でも届くので、**本当に無いときだけ聞く**
      const gone = !(await noteExists(root, change.path));
      if (!gone) return;
      // **自動保存を止める。** 止めないと、聞いている間に予約が起きて
      // 消えたファイルを黙って作り直してしまう
      autosave.cancel();
      // 聞いている間は保存できない状態。書いたものは退避しておく（H-1）
      void keepStash(root, change.path, readTextRef.current());
      setDeleted(change.path);
      return;
    }
    const text = await readNote(root, change.path);
    // 中身が変わっていなければ外部の変更ではない（known の説明を参照）。
    // 画面と同じでも同様 — 読み直してもキャレットが動くだけ
    const unchanged =
      (known.current?.path === change.path && known.current.text === text) ||
      text === readTextRef.current();
    if (unchanged) return;
    if (!dirty.current) {
      known.current = { path: change.path, text };
      replaceTextRef.current(text); // 静かにリロード（キャレット維持）
      return;
    }
    // 競合。3 択（外部 / 自分 / 両方残す = spec §7.5）をアプリ内の
    // ダイアログで聞く（ネイティブの ask は 2 択しかできない）。
    // **予約は先に破棄する** — 残したまま聞くと、答える前に自動保存が
    // 発火して自分の版で外部の変更を潰す（レビュー 2026-09-04）
    autosave.cancel();
    setConflict({ path: change.path, externalText: text });
    // 競合の解決を待つ間は保存できない。**その間も保険は要る**（H-1）
    void keepStash(root, change.path, readTextRef.current());
  }

  // 登録は一度だけ。ハンドラが読む値はすべて ref 経由
  useEffect(
    () => subscribeVaultChanged((change) => void handleExternalChange(change)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function resolveConflict(choice: "external" | "mine" | "both") {
    const root = vaultRootRef.current;
    if (!conflict || !root) return;
    const found = conflict;
    setConflict(null);
    // どの道を選んでも「保存できない状態」は終わる。保険は捨てる
    dropStash(root, found.path);
    if (choice === "external") {
      adopt(found.externalText);
      onStatusRef.current("外部の変更を読み込みました");
      return;
    }
    if (choice === "mine") {
      // flush は予約が無いと何もしない（保存が一度失敗した後など）。
      // 予約の有無に関わらず、必ず今の本文を書く（レビュー 2026-09-04）
      await autosave.flush();
      if (dirty.current) {
        try {
          await pendingSave.current?.();
        } catch (error) {
          onStatusRef.current(`保存に失敗: ${String(error)}`);
          return;
        }
      }
      onStatusRef.current("自分の版で上書きしました");
      return;
    }
    // 両方残す: 自分の版を競合コピーへ、このノートは外部の版に
    const copy = await conflictCopy(root, found.path, readTextRef.current());
    adopt(found.externalText);
    await refreshListsRef.current();
    onStatusRef.current(
      `自分の版を「${copy.slice(root.length + 1).replace(/\.(md|markdown)$/i, "")}」に残しました`,
    );
  }

  /// 外部で消されたノートを、編集中の内容で作り直す
  async function recreateDeleted() {
    const root = vaultRootRef.current;
    const path = deleted;
    if (!root || !path) return;
    setDeleted(null);
    try {
      const text = readTextRef.current();
      await writeNote(root, path, text, historyMinutesRef.current);
      known.current = { path, text };
      dirty.current = false;
      dropStash(root, path);
      await refreshListsRef.current();
      onStatusRef.current("編集中の内容で作り直しました");
    } catch (error) {
      onStatusRef.current(`作り直せませんでした: ${String(error)}`);
    }
  }

  /// 作り直さずに閉じる。**本文だけ消すのでは足りない** — 題名や
  /// 未保存の予約に消えたノートが残ると、表示が嘘をつく。
  function closeDeleted() {
    setDeleted(null);
    dropPending();
    dirty.current = false;
    onCloseNote();
    onStatusRef.current(
      "外部で削除されたので閉じました（退避は残してあります）",
    );
  }

  // ---- 前回の未保存内容（クラッシュ退避 / H-1）。0 件なら聞かない
  const [recovery, setRecovery] = useState(0);
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
    const root = vaultRootRef.current;
    if (!root) return;
    setRecovery(0);
    if (!restore) {
      await clearRecovery(root);
      return;
    }
    const written = await restoreRecovery(root);
    await refreshListsRef.current();
    await onRecovered(written);
    onStatusRef.current(
      `未保存の内容を ${written.length} 件、別ファイルに復元しました`,
    );
  }

  return {
    savedAt,
    noteChanged,
    flush,
    cancel,
    dropPending,
    markOpened,
    adopt,
    conflict,
    resolveConflict,
    deleted,
    recreateDeleted,
    closeDeleted,
    recovery,
    handleRecovery,
  };
}
