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
mod locked;
mod notes;
mod paths;
mod scan;
mod seed;
mod templates;
mod text;
mod trash;

pub use attachments::*;
pub use history_carry::*;
pub use locked::*;
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
    /// 各 Mac のもの（索引と二重起動ロック）の置き場。保管フォルダの外
    local: PathBuf,
}

/// Tauri の identifier（tauri.conf.json）。App Support の下の名前に使う。
/// 退避は Tauri の app_data_dir に置くので、ずれると 2 か所に散る（テストが見張る）
pub const APP_IDENTIFIER: &str = "app.oboegaki.desktop";

/// 各 Mac の置き場の中で、保管フォルダごとの置き場を並べるフォルダ
pub const LOCAL_DIRNAME: &str = "vaults";

/// 捨ててよいもの（索引とロック）の、旧い置き場での名前。開くときに一度だけ消す
const LEGACY_LOCAL_FILES: [&str; 4] = [
    "index.sqlite",
    "index.sqlite-wal",
    "index.sqlite-shm",
    "instance-oboegaki.lock",
];

/// パスから作る短い鍵（16 進 24 字）。保管フォルダごと・ノートごとに置き場を分ける。
/// 退避（recovery）と同じ鍵 — 同じ保管フォルダは App Support の下で同じ名前になる
pub fn path_key(path: &Path) -> String {
    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(path.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// ホームから見たこのアプリの App Support（Tauri の app_data_dir と同じ場所）。
/// Tauri に頼らず決める — MCP サーバ（別のプロセス）も同じ置き場を見るため
pub fn app_support_in(home: &Path) -> PathBuf {
    home.join("Library/Application Support")
        .join(APP_IDENTIFIER)
}

/// 保管フォルダごとの、各 Mac の置き場（ADR-0052 決定 1）
pub fn local_dir_in(app_support: &Path, root: &Path) -> PathBuf {
    app_support.join(LOCAL_DIRNAME).join(path_key(root))
}

/// App Support を差し替える環境変数。**本番では設定しない。** 本番として組んだバイナリを
/// 動かすテスト（tests/mcp_stdio.rs）が、本物の App Support に書かないための口
/// （cfg(test) は lib の単体テストにしか効かない。2026-10-06）
pub const APP_SUPPORT_ENV: &str = "OBOEGAKI_APP_SUPPORT";

/// 各 Mac の置き場の根（App Support）。上書き（APP_SUPPORT_ENV）が先、無ければホームの下。
/// どちらも無ければ None
pub fn local_base(
    overridden: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    if let Some(base) = overridden.filter(|base| !base.is_empty()) {
        return Some(PathBuf::from(base));
    }
    home.filter(|home| !home.is_empty())
        .map(|home| app_support_in(Path::new(&home)))
}

/// 既定の置き場。ホームが分からなければ、仕方なく管理フォルダの中（旧の置き場）
#[cfg(not(test))]
fn default_local_dir(root: &Path) -> PathBuf {
    match local_base(std::env::var_os(APP_SUPPORT_ENV), std::env::var_os("HOME")) {
        Some(base) => local_dir_in(&base, root),
        None => root.join(MANAGED_DIR),
    }
}

/// テストでは本物の App Support に書かない。一時フォルダ（保管フォルダ）と一緒に
/// 片づくよう、管理フォルダの中に置く（一覧の走査は管理フォルダを見ない）
#[cfg(test)]
fn default_local_dir(root: &Path) -> PathBuf {
    root.join(MANAGED_DIR).join("local")
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
        let root = root.into();
        let local = default_local_dir(&root);
        Self { root, local }
    }

    /// 各 Mac の置き場を決めて開く（テストと、置き場を選びたい呼び手向け）
    pub fn with_local_dir(root: impl Into<PathBuf>, local: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            local: local.into(),
        }
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

    /// 索引と二重起動ロックの置き場（各 Mac のもの。ADR-0052 決定 1）。
    /// 保管フォルダは共有してよいが、これは共有しない — SQLite は同期ソフトで運ぶと壊れる
    pub fn local_dir(&self) -> PathBuf {
        self.local.clone()
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
        self.drop_legacy_local_files();
        Ok(())
    }

    /// 管理フォルダに置いていた索引とロックを消す（11-1）。捨ててよいもの（T7）なので、
    /// 置き場を移したあとに残すと同期ソフトが運び続けるだけになる。消せなくても開ける
    fn drop_legacy_local_files(&self) {
        let managed = self.managed_dir();
        if self.local == managed {
            return;
        }
        for name in LEGACY_LOCAL_FILES {
            let _ = fs::remove_file(managed.join(name));
        }
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

    // ---------------------------------------- 各 Mac の置き場（ADR-0052 決定 1 / 11-1）

    #[test]
    fn test_各Macの置き場は保管フォルダごとに分かれる() {
        let base = Path::new("/base");
        let one = local_dir_in(base, Path::new("/a/notes"));
        assert!(one.starts_with(base.join(LOCAL_DIRNAME)));
        assert_ne!(one, local_dir_in(base, Path::new("/b/notes")));
        // 同じ保管フォルダなら同じ置き場（アプリと MCP サーバが同じ索引・ロックを見る）
        assert_eq!(one, local_dir_in(base, Path::new("/a/notes")));
    }

    #[test]
    fn test_各Macの置き場はホームのApplication_Supportの下() {
        assert_eq!(
            app_support_in(Path::new("/Users/someone")),
            Path::new("/Users/someone/Library/Application Support/app.oboegaki.desktop")
        );
    }

    #[test]
    fn test_各Macの置き場の名前はTauriのidentifierと同じ() {
        // 退避（recovery）は Tauri の app_data_dir に置く。名前がずれると
        // 同じアプリのものが App Support の 2 か所に散る
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
    }

    #[test]
    fn test_索引とロックは保管フォルダの中に作らない() {
        let root = TempDir::new().unwrap();
        let local = TempDir::new().unwrap();
        let vault = Vault::with_local_dir(root.path(), local.path());
        vault.ensure_layout().unwrap();
        blank_note(root.path(), "a.md");

        crate::index_db::IndexDb::open(&vault.local_dir())
            .unwrap()
            .sync(&vault)
            .unwrap();
        let _held = crate::vault_lock::acquire(&vault.local_dir());

        // 同期ソフトが SQLite の本体と -wal を別々に運ぶと壊れる（ADR-0052）
        let mut inside = Vec::new();
        let mut stack = vec![root.path().to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    inside.push(entry.file_name().to_string_lossy().into_owned());
                }
            }
        }
        assert!(
            inside
                .iter()
                .all(|name| !name.starts_with(crate::index_db::INDEX_FILE)
                    && name != crate::vault_lock::LOCK_FILE),
            "保管フォルダの中に {inside:?}"
        );
        assert!(local.path().join(crate::index_db::INDEX_FILE).is_file());
        assert!(local.path().join(crate::vault_lock::LOCK_FILE).is_file());
    }

    #[test]
    fn test_開くとき保管フォルダの中の古い索引とロックを消す() {
        let root = TempDir::new().unwrap();
        let local = TempDir::new().unwrap();
        let managed = root.path().join(MANAGED_DIR);
        fs::create_dir_all(managed.join("history")).unwrap();
        for name in [
            "index.sqlite",
            "index.sqlite-wal",
            "index.sqlite-shm",
            "instance-oboegaki.lock",
        ] {
            fs::write(managed.join(name), "old").unwrap();
        }
        fs::write(managed.join("history/a.md"), "版").unwrap();

        Vault::with_local_dir(root.path(), local.path())
            .ensure_layout()
            .unwrap();

        let left: Vec<_> = fs::read_dir(&managed)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(left, ["history"]);
        // 履歴は作り直せない（ADR-0023）。消すのは捨ててよいものだけ
        assert_eq!(
            fs::read_to_string(managed.join("history/a.md")).unwrap(),
            "版"
        );
    }

    #[test]
    fn test_置き場が保管フォルダの中のままなら古い索引を消さない() {
        // ホームが分からず管理フォルダに置くしかないとき。消すと毎回作り直しになる
        let root = TempDir::new().unwrap();
        let managed = root.path().join(MANAGED_DIR);
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("index.sqlite"), "live").unwrap();

        Vault::with_local_dir(root.path(), &managed)
            .ensure_layout()
            .unwrap();

        assert!(managed.join("index.sqlite").is_file());
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

    #[test]
    fn test_各Macの置き場は環境変数で差し替えられ_無ければホームの下() {
        // 本番として組んだバイナリを動かすテスト（tests/mcp_stdio.rs）が、本物の
        // App Support に書かないための口（2026-10-06）
        let home = Some(std::ffi::OsString::from("/Users/someone"));
        assert_eq!(
            local_base(Some("/tmp/置き場".into()), home.clone()),
            Some(PathBuf::from("/tmp/置き場"))
        );
        assert_eq!(
            local_base(None, home.clone()),
            Some(app_support_in(Path::new("/Users/someone")))
        );
        // 空の値は無いのと同じ
        assert_eq!(
            local_base(Some("".into()), home),
            Some(app_support_in(Path::new("/Users/someone")))
        );
        assert_eq!(local_base(None, None), None);
    }
}
