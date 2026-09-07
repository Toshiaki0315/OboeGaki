// 前回開いた vault の記憶（TASKS 1-1、参照実装 config.vault_path / Q-6）。
//
// 置き場は localStorage（キーは他の設定と同じ "oboegaki." 系）。
// 記憶はあくまで利便で、開けなければ黙って忘れてフォルダ選択に落ちる。
// storage は注入にして WebView 無しでテストできる形に保つ。

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const VAULT_KEY = "oboegaki.vault";

/// 「既に別のウィンドウで開いている」の印（Rust 側 vault_open が返す
/// メッセージの頭）。**「開けない」と区別する**ためだけに使う。
export const VAULT_BUSY = "vault-busy";

/// その失敗が二重起動の断りか。
export function isVaultBusy(error: unknown): boolean {
  return String(error).includes(VAULT_BUSY);
}

/// 画面に出す文言（印を落とす）。
export function vaultErrorText(error: unknown): string {
  return String(error).replace(new RegExp(`.*${VAULT_BUSY}:\\s*`), "");
}

export function saveLastVault(storage: StorageLike, root: string): void {
  try {
    storage.setItem(VAULT_KEY, root);
  } catch {
    // 記憶できなくても今開いている vault は生きている
  }
}

/// 記憶している vault を開き直す。成功したらそのパス、
/// 記憶が無い・開けないときは null（開けなかった記憶は忘れる）。
export async function restoreLastVault(
  storage: StorageLike,
  openVault: (root: string) => Promise<void>,
): Promise<string | null> {
  let root: string | null;
  try {
    root = storage.getItem(VAULT_KEY);
  } catch {
    return null;
  }
  if (!root) return null;
  try {
    await openVault(root);
    return root;
  } catch (error) {
    // **二重起動の断りは忘れない。** 向こうを閉じれば次は開ける。忘れると、
    // 閉じたあとに前回の vault へ戻れなくなる
    if (isVaultBusy(error)) throw error;
    try {
      storage.removeItem(VAULT_KEY);
    } catch {
      // 忘れられなくても致命ではない（次回また試して失敗するだけ）
    }
    return null;
  }
}

// ---- 最後に開いたノート（要望 2026-09-08。参照実装 session/last_note）。
// 保管フォルダからの相対で覚える — 保管フォルダを動かしても追いかけられ、
// 別の保管フォルダの記憶を取り違えない。

export const LAST_NOTE_KEY = "oboegaki.last-note";

export function saveLastNote(
  storage: StorageLike,
  root: string,
  path: string,
): void {
  const prefix = `${root}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  try {
    storage.setItem(LAST_NOTE_KEY, JSON.stringify({ root, path: relative }));
  } catch {
    // 記憶できなくても今開いているノートは生きている
  }
}

export function forgetLastNote(storage: StorageLike): void {
  try {
    storage.removeItem(LAST_NOTE_KEY);
  } catch {
    // 忘れられなくても致命ではない
  }
}

/// この保管フォルダで最後に開いていたノート（絶対パス）。記憶が無い・
/// 別の保管フォルダの記憶・壊れているときは null
export function lastNoteFor(storage: StorageLike, root: string): string | null {
  try {
    const raw = storage.getItem(LAST_NOTE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { root: kept, path } = parsed as { root?: unknown; path?: unknown };
    if (kept !== root || typeof path !== "string" || !path) return null;
    return `${root}/${path}`;
  } catch {
    return null;
  }
}
