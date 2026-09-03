// vault 単位の二重起動ロック（H-1 層 2 / spec §6.1）。
// 参照実装 app.acquire_vault_lock の移植。
//
// 同じ vault を 2 つのウィンドウで開くと、watcher が互いの保存に反応し、
// 競合ダイアログが行き来する。
//
// ロックは**ファイルロック**（OS の助言ロック）で取る。PID を書いて死活を
// 見る方式と違い、**落ちた後の残骸が残らない**（プロセスが消えれば OS が
// 外す）。ロックの実体は管理フォルダの中なので捨ててよい（T7）。

use std::fs::{File, OpenOptions};
use std::path::Path;

pub const LOCK_FILE: &str = "instance.lock";

/// 取れたロック。**アプリが vault を開いている間は持ち続けること**
/// （手放すと OS がロックを外す）。
pub struct VaultLock {
    _file: File,
}

pub enum LockOutcome {
    Acquired(VaultLock),
    /// **本当に**別の窓が持っている。
    Busy,
    /// 置けなかった（読み取り専用の場所など）。
    ///
    /// 開けない保管フォルダと同じ扱いにする。中を読み書きできないのだから
    /// 二重に開いても壊れるものがない。**Busy と混ぜない** — 混ぜると
    /// 開いてもいないのに「別のウィンドウで開いています」と嘘をつく。
    Unavailable,
}

/// 管理フォルダにロックを置く。
pub fn acquire(managed_dir: &Path) -> LockOutcome {
    if std::fs::create_dir_all(managed_dir).is_err() {
        return LockOutcome::Unavailable;
    }
    let Ok(file) = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(managed_dir.join(LOCK_FILE))
    else {
        return LockOutcome::Unavailable;
    };
    match file.try_lock() {
        Ok(()) => LockOutcome::Acquired(VaultLock { _file: file }),
        Err(std::fs::TryLockError::WouldBlock) => LockOutcome::Busy,
        // ロックそのものが使えない置き場（ネットワーク越しなど）。
        // 守るものが無いのと同じ扱いにする
        Err(_) => LockOutcome::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_acquire_取れたら保持し_2つ目は断る() {
        let dir = TempDir::new().unwrap();

        let first = acquire(dir.path());
        assert!(matches!(first, LockOutcome::Acquired(_)));
        // **持っている間**は 2 つ目を断る（2 窓で開くと watcher が互いの
        // 保存に反応し、競合ダイアログが行き来する）
        assert!(matches!(acquire(dir.path()), LockOutcome::Busy));

        drop(first);
        assert!(matches!(acquire(dir.path()), LockOutcome::Acquired(_)));
    }

    #[test]
    fn test_acquire_置けない場所は素通しする() {
        // 守るものが無い（読み書きできない場所）。**「別のウィンドウで
        // 開いています」は嘘になる**ので Busy とは混ぜない
        let outcome = acquire(Path::new("/dev/null/置けない"));
        assert!(matches!(outcome, LockOutcome::Unavailable));
    }

    #[test]
    fn test_acquire_別のvaultは互いに邪魔しない() {
        let one = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();

        let _held = acquire(one.path());
        assert!(matches!(acquire(other.path()), LockOutcome::Acquired(_)));
    }

    #[test]
    fn test_acquire_置いたロックは管理フォルダの中() {
        let dir = TempDir::new().unwrap();
        let managed = dir.path().join(".OboeGaki");

        let _held = acquire(&managed);

        // 索引と同じ「捨ててよい」置き場（T7）
        assert!(managed.join(LOCK_FILE).is_file());
    }
}
