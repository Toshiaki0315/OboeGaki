// vault のレイアウトと走査（spec §7.1）。参照実装 hitofude/storage/vault.py の移植。
//
// WebView 非依存の純 Rust（T3）。挙動は参照実装に合わせる:
//   - 旧 `.hitofude` は開くときに一度だけ `.OboeGaki` へ改名して引き継ぐ（ADR-0032）
//   - 走査は `.md`/`.markdown` のみ。`.trash`・管理フォルダ・attachments・
//     templates・ドット始まりのフォルダは除く
//   - vault の外へ出るシンボリックリンクは辿らない（vault の自己完結を守る）
//   - 祖先へ戻るリンクは辿らない（無限再帰と重複を防ぐ）
//   - 読めないフォルダで走査ごと止めない

use crate::template::{daily_title, expand};
use chrono::{DateTime, Local};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

// 19-2 で機能ごとに分けた。外から見える名前はここで再エクスポートする
mod attachments;
mod daily;
mod history_carry;
mod notes;
mod paths;
mod scan;
mod seed;
mod templates;
mod text;
mod trash;

pub use attachments::*;
pub use history_carry::*;
pub use paths::*;
use scan::*;
use templates::*;
pub use text::*;

pub const TRASH_DIR: &str = ".trash";

pub const MANAGED_DIR: &str = ".OboeGaki";

/// 旧名（改名 2026-08-27 / ADR-0032）。開くときに一度だけ改名して引き継ぐ。
pub const LEGACY_MANAGED_DIR: &str = ".hitofude";

/// 既定の保管フォルダの名前（ADR-0032 決定 3）。
pub const DEFAULT_VAULT_NAME: &str = "OboeGakiNotes";

/// 旧の既定名。**パスを保存していない人を置き去りにしない**。
pub const LEGACY_VAULT_NAME: &str = "HitofudeNotes";

pub const ATTACHMENTS_DIR: &str = "attachments";

pub const TEMPLATES_DIR: &str = "templates";

const MARKDOWN_SUFFIXES: [&str; 2] = ["md", "markdown"];

/// macOS が勝手に置くファイル。フォルダが「空か」の判定では無視する。
const IGNORED_FILE: &str = ".DS_Store";

/// タイトルが空のときのフォールバック（参照実装 core/document.py と同じ値）。
pub const UNTITLED: &str = "無題";

/// ファイル名の上限は 255 バイト。日本語は 1 文字 3 バイトなので余裕を取る。
const MAX_FILENAME_BYTES: usize = 200;

/// 走査から外すフォルダ。watcher 側もこれを使うこと（参照実装の E-4 の教訓:
/// 2 か所に書くと「一覧には出ないのに索引には入る」食い違いが出る）。
pub(crate) const SKIP_DIRS: [&str; 4] = [TRASH_DIR, MANAGED_DIR, ATTACHMENTS_DIR, TEMPLATES_DIR];

/// 同梱の雛形（E-4）。**ただの `.md`** なので Finder で足しても増やせる。
/// 実体をアプリに埋め込むのは、配布物のどこに置かれても読めるようにするため。
pub const DAILY_TEMPLATE: &str = "日次.md";

pub const DEFAULT_TEMPLATES: [(&str, &str); 3] = [
    (
        DAILY_TEMPLATE,
        include_str!("../../resources/templates/日次.md"),
    ),
    (
        "議事録.md",
        include_str!("../../resources/templates/議事録.md"),
    ),
    ("日報.md", include_str!("../../resources/templates/日報.md")),
];

/// 置いた雛形の名前を残す印。**名前で覚える**ので、手で消した雛形は
/// 復活せず、あとから増えた雛形は届く（参照実装で日時だけを書いていた
/// ときは、新しい雛形が永久に現れなかった）。
const TEMPLATES_MARKER: &str = "templates-seeded";

/// 同梱の使い方ノート。初回だけ置く（ヘルプから置き直せる）。
pub const MANUAL_TITLE: &str = "おぼえがきの使い方";

pub const MANUAL: &str = include_str!("../../resources/manual.md");

/// 一度置いたら二度と置き直さない印。消したマニュアルを復活させない。
const MANUAL_MARKER: &str = "seeded";

/// 同梱の「Claude とつなぐ（MCP）の使い方」。**初回には置かない** —
/// 繋ぐ気のない人の一覧に増やさない。ヘルプメニューから頼まれたら置く
pub const MCP_MANUAL_TITLE: &str = "Claude とつなぐ（MCP）の使い方";

pub const MCP_MANUAL: &str = include_str!("../../resources/mcp-manual.md");

/// 作ったばかりのノート。`cursor` は `{{cursor}}` があった位置
/// （**UTF-16 コード単位**。CM6 のオフセットにそのまま渡せる）。
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct NewNote {
    pub path: PathBuf,
    pub cursor: Option<usize>,
}

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

/// 既定の保管フォルダ（ADR-0032 決定 3）。
///
/// **パスを保存していない人を置き去りにしない。** 旧の既定フォルダが
/// 在って、新しい名前がまだ無ければ、旧のほうを使い続ける。**フォルダは
/// 動かさない**（iCloud / Dropbox の同期下にあり得る）。新しい名前が
/// 既に在るなら引っ越し済みなので、そちらが正。
pub fn default_vault_in(documents: &Path) -> PathBuf {
    let fresh = documents.join(DEFAULT_VAULT_NAME);
    let legacy = documents.join(LEGACY_VAULT_NAME);
    if !fresh.exists() && legacy.is_dir() {
        return legacy;
    }
    fresh
}

/// ゴミ箱の 1 件。
#[derive(Debug, PartialEq)]
pub struct TrashEntry {
    pub path: PathBuf,
    /// 捨てた時刻（ミリ秒）。読めなければ 0。
    pub trashed_ms: i64,
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
            self.templates_dir(),
        ] {
            fs::create_dir_all(directory)?;
        }
        Ok(())
    }

    // --------------------------------------------------------------- 初回
    /// ノートが 1 つも無い vault か。
    pub fn is_empty(&self) -> bool {
        self.scan().is_empty()
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{blank_note, temp_vault};
    use std::fs;
    use tempfile::TempDir;

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
    fn test_既定の保管フォルダは新しい名前() {
        let home = TempDir::new().unwrap();
        let documents = home.path().join("Documents");
        fs::create_dir_all(&documents).unwrap();

        assert_eq!(
            default_vault_in(&documents),
            documents.join(DEFAULT_VAULT_NAME)
        );
    }

    #[test]
    fn test_旧の既定フォルダが在ればそれを使い続ける() {
        // **フォルダは動かさない**（iCloud / Dropbox の同期下にあり得る）。
        // パスを保存していない人を置き去りにしない（ADR-0032 決定 3）
        let home = TempDir::new().unwrap();
        let documents = home.path().join("Documents");
        fs::create_dir_all(documents.join(LEGACY_VAULT_NAME)).unwrap();

        assert_eq!(
            default_vault_in(&documents),
            documents.join(LEGACY_VAULT_NAME)
        );
    }

    #[test]
    fn test_新しい名前が既に在れば引っ越し済みとみなす() {
        let home = TempDir::new().unwrap();
        let documents = home.path().join("Documents");
        fs::create_dir_all(documents.join(LEGACY_VAULT_NAME)).unwrap();
        fs::create_dir_all(documents.join(DEFAULT_VAULT_NAME)).unwrap();

        assert_eq!(
            default_vault_in(&documents),
            documents.join(DEFAULT_VAULT_NAME)
        );
    }

    #[test]
    fn test_is_empty_ゴミ箱と雛形しか無い_vault_は空() {
        let (root, vault) = temp_vault();
        assert!(vault.is_empty());
        blank_note(root.path(), &format!("{TRASH_DIR}/捨てた.md"));
        blank_note(root.path(), "templates/雛形.md");
        assert!(vault.is_empty()); // 一覧に出ないものは数えない
        blank_note(root.path(), "仕事/a.md");
        assert!(!vault.is_empty());
    }
}
