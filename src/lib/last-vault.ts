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
  let root: string | null = null;
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
