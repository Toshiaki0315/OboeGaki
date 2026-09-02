// vault のレイアウトと走査（spec §7.1）。参照実装 hitofude/storage/vault.py の移植。
//
// WebView 非依存の純 Rust（T3）。挙動は参照実装に合わせる:
//   - 旧 `.hitofude` は開くときに一度だけ `.OboeGaki` へ改名して引き継ぐ（ADR-0032）
//   - 走査は `.md`/`.markdown` のみ。`.trash`・管理フォルダ・attachments・
//     templates・ドット始まりのフォルダは除く
//   - vault の外へ出るシンボリックリンクは辿らない（vault の自己完結を守る）
//   - 祖先へ戻るリンクは辿らない（無限再帰と重複を防ぐ）
//   - 読めないフォルダで走査ごと止めない

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const TRASH_DIR: &str = ".trash";
pub const MANAGED_DIR: &str = ".OboeGaki";
/// 旧名（改名 2026-08-27 / ADR-0032）。開くときに一度だけ改名して引き継ぐ。
pub const LEGACY_MANAGED_DIR: &str = ".hitofude";
pub const ATTACHMENTS_DIR: &str = "attachments";
pub const TEMPLATES_DIR: &str = "templates";

const MARKDOWN_SUFFIXES: [&str; 2] = ["md", "markdown"];
/// 走査から外すフォルダ。watcher 側もこれを使うこと（参照実装の E-4 の教訓:
/// 2 か所に書くと「一覧には出ないのに索引には入る」食い違いが出る）。
const SKIP_DIRS: [&str; 4] = [TRASH_DIR, MANAGED_DIR, ATTACHMENTS_DIR, TEMPLATES_DIR];

/// 旧名 `.hitofude` を `.OboeGaki` へ改名して引き継ぐ（ADR-0032）。
///
/// 索引は捨ててよいが `history/` の版は作り直せない（ADR-0023）ので
/// 中身ごと連れて行く。同一ボリューム内の rename 1 回で原子的。
/// 両方あるとき（引っ越し済み）は新しい側が正で、旧側は触らない。
pub fn migrate_managed_dir(root: &Path) -> io::Result<()> {
    let legacy = root.join(LEGACY_MANAGED_DIR);
    let target = root.join(MANAGED_DIR);
    if legacy.is_dir() && !target.exists() {
        fs::rename(&legacy, &target)?;
    }
    Ok(())
}

pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn trash_dir(&self) -> PathBuf {
        self.root.join(TRASH_DIR)
    }

    pub fn managed_dir(&self) -> PathBuf {
        self.root.join(MANAGED_DIR)
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join(ATTACHMENTS_DIR)
    }

    pub fn templates_dir(&self) -> PathBuf {
        self.root.join(TEMPLATES_DIR)
    }

    /// 改名引き継ぎを通してから、必要なフォルダを作る。
    pub fn ensure_layout(&self) -> io::Result<()> {
        migrate_managed_dir(&self.root)?;
        for directory in [
            self.root.clone(),
            self.trash_dir(),
            self.managed_dir(),
            self.attachments_dir(),
        ] {
            fs::create_dir_all(directory)?;
        }
        Ok(())
    }

    /// vault 内の Markdown ファイルをフォルダごとの名前順で返す。
    pub fn scan(&self) -> Vec<PathBuf> {
        let mut found = Vec::new();
        if !self.root.is_dir() {
            return found;
        }
        let mut ancestors = HashSet::new();
        if let Ok(real) = self.root.canonicalize() {
            ancestors.insert(real);
        }
        self.walk(&self.root, &ancestors, &mut found);
        found
    }

    fn walk(&self, directory: &Path, ancestors: &HashSet<PathBuf>, found: &mut Vec<PathBuf>) {
        // 読めないフォルダで走査ごと止めない。索引の同期はまるごと 1 回の
        // 処理なので、途中で失敗すると他の正常なノートまで索引に入らない
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for entry in paths {
            // 保管フォルダの外へ出るリンクは辿らない。辿ると外のノートが
            // 索引に入り、編集やゴミ箱移動の対象になって vault が
            // 自己完結しなくなる
            let is_symlink = entry
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);
            if is_symlink && !self.inside(&entry) {
                continue;
            }
            if entry.is_dir() {
                let name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if SKIP_DIRS.contains(&name) || name.starts_with('.') {
                    continue;
                }
                // 祖先へ戻るリンクは辿らない。中を指すリンクは inside を通る
                // ため、これが無いと同じノートを別パスで重複して返し続ける。
                // 祖先だけを見るのは、兄弟への別名リンク（辿ってよい）を
                // 巻き込まないため
                let Ok(real) = entry.canonicalize() else {
                    continue;
                };
                if ancestors.contains(&real) {
                    continue;
                }
                let mut next = ancestors.clone();
                next.insert(real);
                self.walk(&entry, &next, found);
            } else if is_markdown(&entry) {
                found.push(entry);
            }
        }
    }

    /// リンクを辿った先が保管フォルダの中に留まるか。
    fn inside(&self, entry: &Path) -> bool {
        match (entry.canonicalize(), self.root.canonicalize()) {
            (Ok(resolved), Ok(root)) => resolved.starts_with(root),
            _ => false,
        }
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_SUFFIXES.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn note(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "# note\n").unwrap();
        path
    }

    #[test]
    fn test_migrate_旧名だけがあるとき改名して中身ごと引き継ぐ() {
        let root = TempDir::new().unwrap();
        let legacy = root.path().join(LEGACY_MANAGED_DIR);
        fs::create_dir_all(legacy.join("history")).unwrap();
        fs::write(legacy.join("history/a.md"), "old").unwrap();

        migrate_managed_dir(root.path()).unwrap();

        assert!(!legacy.exists());
        let migrated = root.path().join(MANAGED_DIR).join("history/a.md");
        assert_eq!(fs::read_to_string(migrated).unwrap(), "old");
    }

    #[test]
    fn test_migrate_両方あるときは旧側を触らない() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join(LEGACY_MANAGED_DIR)).unwrap();
        fs::create_dir(root.path().join(MANAGED_DIR)).unwrap();

        migrate_managed_dir(root.path()).unwrap();

        assert!(root.path().join(LEGACY_MANAGED_DIR).exists());
        assert!(root.path().join(MANAGED_DIR).exists());
    }

    #[test]
    fn test_migrate_どちらも無いときは何もしない() {
        let root = TempDir::new().unwrap();
        migrate_managed_dir(root.path()).unwrap();
        assert!(!root.path().join(MANAGED_DIR).exists());
    }

    #[test]
    fn test_ensure_layout_必要なフォルダを作り改名引き継ぎも通す() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join(LEGACY_MANAGED_DIR)).unwrap();

        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        assert!(vault.trash_dir().is_dir());
        assert!(vault.managed_dir().is_dir());
        assert!(vault.attachments_dir().is_dir());
        assert!(!root.path().join(LEGACY_MANAGED_DIR).exists());
    }

    #[test]
    fn test_scan_mdとmarkdownを拾い他の拡張子を無視する() {
        let root = TempDir::new().unwrap();
        let a = note(root.path(), "a.md");
        let b = note(root.path(), "b.markdown");
        let c = note(root.path(), "大文字.MD");
        note(root.path(), "d.txt");

        // 名前順（UTF-8 バイト順）: ASCII の 2 つが先、多バイトの「大文字」が後
        assert_eq!(Vault::new(root.path()).scan(), vec![a, b, c]);
    }

    #[test]
    fn test_scan_trashと管理フォルダとドット始まりを除く() {
        let root = TempDir::new().unwrap();
        let keep = note(root.path(), "sub/keep.md");
        note(root.path(), &format!("{TRASH_DIR}/gone.md"));
        note(root.path(), &format!("{MANAGED_DIR}/index.md"));
        note(root.path(), &format!("{ATTACHMENTS_DIR}/pic.md"));
        note(root.path(), &format!("{TEMPLATES_DIR}/daily.md"));
        note(root.path(), ".hidden/secret.md");

        assert_eq!(Vault::new(root.path()).scan(), vec![keep]);
    }

    #[test]
    fn test_scan_フォルダごとの名前順で深さ優先に返す() {
        let root = TempDir::new().unwrap();
        let b = note(root.path(), "b.md");
        let inner = note(root.path(), "a-dir/inner.md");
        let a = note(root.path(), "a.md");

        assert_eq!(Vault::new(root.path()).scan(), vec![inner, a, b]);
    }

    #[test]
    fn test_scan_vault外へのシンボリックリンクを辿らない() {
        let outside = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        note(outside.path(), "escape.md");
        fs::create_dir_all(outside.path().join("dir")).unwrap();
        note(&outside.path().join("dir"), "in-dir.md");
        symlink(
            outside.path().join("escape.md"),
            root.path().join("link.md"),
        )
        .unwrap();
        symlink(outside.path().join("dir"), root.path().join("linkdir")).unwrap();

        assert_eq!(Vault::new(root.path()).scan(), Vec::<PathBuf>::new());
    }

    #[test]
    fn test_scan_祖先へ戻るリンクで無限再帰しない() {
        let root = TempDir::new().unwrap();
        let a = note(root.path(), "a.md");
        symlink(root.path(), root.path().join("loop")).unwrap();

        assert_eq!(Vault::new(root.path()).scan(), vec![a]);
    }
}
