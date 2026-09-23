//! テストの足場（テストだけが読む。`#[cfg(test)]` で lib.rs から繋ぐ）。
//! 「一時フォルダ → Vault::new → ensure_layout」の 3 点セットが 93 か所、
//! `note()` と `at()` が完全一致で 2 か所ずつあった（19-1。2026-09-18）。
//! 準備が揃っていないと「ensure_layout を呼び忘れたテストだけ挙動が違う」が起きる

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, TimeZone};
use tempfile::TempDir;

use crate::vault::Vault;

/// 一時フォルダに保管フォルダを作る（管理フォルダのレイアウトまで）。
/// TempDir は捨てると消えるので、呼び手が生かしておく
pub fn temp_vault() -> (TempDir, Vault) {
    let root = TempDir::new().unwrap();
    let vault = Vault::new(root.path());
    vault.ensure_layout().unwrap();
    (root, vault)
}

/// ノートを置く（親フォルダも作る）。置いた場所を返す
pub fn note(root: &Path, name: &str, text: &str) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, text).unwrap();
    path
}

/// 中身が `# note` だけのノートを置く（場所だけが要るテスト向け）
pub fn blank_note(dir: &Path, name: &str) -> PathBuf {
    note(dir, name, "# note\n")
}

/// ローカル時刻（秒は 0）
pub fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
    Local
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .unwrap()
}

/// 履歴の置き場を**書けない**状態にする（版を残すのが失敗する道を試す）。
/// 置き場と、その下のフォルダを全部読み取り専用にし、落とすときに戻す —
/// 戻さないと TempDir が片づけられずに残る
pub struct HistoryLocked {
    folders: Vec<PathBuf>,
}

pub fn lock_history(vault: &Vault) -> HistoryLocked {
    use std::os::unix::fs::PermissionsExt;
    let store = crate::history::store_root(&vault.managed_dir());
    fs::create_dir_all(&store).unwrap();
    let mut folders = vec![store.clone()];
    for entry in fs::read_dir(&store).unwrap().flatten() {
        if entry.path().is_dir() {
            folders.push(entry.path());
        }
    }
    for folder in &folders {
        fs::set_permissions(folder, fs::Permissions::from_mode(0o555)).unwrap();
    }
    HistoryLocked { folders }
}

impl Drop for HistoryLocked {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        for folder in &self.folders {
            let _ = fs::set_permissions(folder, fs::Permissions::from_mode(0o755));
        }
    }
}
