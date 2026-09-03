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

use chrono::{DateTime, Local};

use crate::template::{daily_title, expand};

pub const TRASH_DIR: &str = ".trash";
pub const MANAGED_DIR: &str = ".OboeGaki";
/// 旧名（改名 2026-08-27 / ADR-0032）。開くときに一度だけ改名して引き継ぐ。
pub const LEGACY_MANAGED_DIR: &str = ".hitofude";
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
        include_str!("../resources/templates/日次.md"),
    ),
    (
        "議事録.md",
        include_str!("../resources/templates/議事録.md"),
    ),
    ("日報.md", include_str!("../resources/templates/日報.md")),
];
/// 置いた雛形の名前を残す印。**名前で覚える**ので、手で消した雛形は
/// 復活せず、あとから増えた雛形は届く（参照実装で日時だけを書いていた
/// ときは、新しい雛形が永久に現れなかった）。
const TEMPLATES_MARKER: &str = "templates-seeded";

/// 同梱の使い方ノート。初回だけ置く（ヘルプから置き直せる）。
pub const MANUAL_TITLE: &str = "覚書の使い方";
pub const MANUAL: &str = include_str!("../resources/manual.md");
/// 一度置いたら二度と置き直さない印。消したマニュアルを復活させない。
const MANUAL_MARKER: &str = "seeded";

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

    /// 新しいノートを vault 直下に作って、そのパスを返す。
    ///
    /// 本文はタイトルの見出し 1 行（ADR-0005 の「タイトル ↔ 見出し」の対応）。
    /// front matter の id は履歴（ADR-0023）を実装するときに足す。
    pub fn create(&self, title: &str) -> io::Result<PathBuf> {
        let stem = sanitize_filename(title);
        let path = unique_path(&self.root, &stem, ".md", None);
        crate::autosave::save_atomic(&path, &format!("# {title}\n\n"))?;
        Ok(path)
    }

    /// 本文を指定して新しいノートを作る（雛形から作るとき）。
    pub fn create_with(&self, title: &str, text: &str) -> io::Result<PathBuf> {
        let stem = sanitize_filename(title);
        let path = unique_path(&self.root, &stem, ".md", None);
        crate::autosave::save_atomic(&path, text)?;
        Ok(path)
    }

    // --------------------------------------------------------- テンプレート（E-4）

    /// `templates/` にある雛形。名前順。
    ///
    /// **走査（`scan`）からは外してある**（SKIP_DIRS）。雛形はノートでは
    /// ないので、一覧に出ると本物のノートに混ざる。
    pub fn templates(&self) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(self.templates_dir()) else {
            return Vec::new();
        };
        let mut found: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.is_file() && is_markdown(path))
            .collect();
        found.sort();
        found
    }

    /// まだ置いたことのない既定の雛形を置く。置いたパスを返す。
    ///
    /// 印には**置いた名前**を残す。「一度置いたら二度と置き直さない」を
    /// 守りつつ、あとから増えた雛形は届く。名前で覚えているので、
    /// **手で消した雛形は復活しない**。**既にある名前は上書きしない**
    /// （手で直した雛形を消さない）。
    pub fn seed_templates(&self) -> io::Result<Vec<PathBuf>> {
        let marker = self.managed_dir().join(TEMPLATES_MARKER);
        let mut known: HashSet<String> = fs::read_to_string(&marker)
            .unwrap_or_default()
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| line.ends_with(".md"))
            .collect();

        let mut placed = Vec::new();
        fs::create_dir_all(self.templates_dir())?;
        for (name, text) in DEFAULT_TEMPLATES {
            if !known.insert(name.to_string()) {
                continue;
            }
            let target = self.templates_dir().join(name);
            if target.exists() {
                continue;
            }
            crate::autosave::save_atomic(&target, text)?;
            placed.push(target);
        }
        let mut names: Vec<&String> = known.iter().collect();
        names.sort();
        fs::create_dir_all(self.managed_dir())?;
        let listed: Vec<&str> = names.iter().map(|name| name.as_str()).collect();
        fs::write(&marker, format!("{}\n", listed.join("\n")))?;
        Ok(placed)
    }

    /// 雛形から新しいノートを作る。
    ///
    /// 題名を省いたときは雛形の名前を使う。「議事録」から作ったノートが
    /// 「無題」になるより、あとで直すぶんだけ手が少ない。
    pub fn create_from_template(
        &self,
        template: &Path,
        title: &str,
        now: &DateTime<Local>,
    ) -> io::Result<NewNote> {
        // パスは手で編集できる。外のファイルをノートに変えさせない
        if !self.inside_templates(template) {
            return Err(outside_error("テンプレートではないパス", template));
        }
        let name = if title.is_empty() {
            template
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or(UNTITLED)
        } else {
            title
        };
        let filled = expand(&template_body(&fs::read_to_string(template)?), now, name);
        let path = self.create_with(name, &filled.text)?;
        Ok(NewNote {
            path,
            cursor: filled.cursor,
        })
    }

    /// 今日のノートを開く。無ければ雛形から作る。
    ///
    /// **同じ日に何度呼んでも同じノートを返す。** 2 つできると、どちらに
    /// 書いたか分からなくなる。`.md` は vault 直下に置く（日付でフォルダを
    /// 切らないのは spec §7.1 — 分類はタグで行う）。
    pub fn daily_note(&self, now: &DateTime<Local>) -> io::Result<NewNote> {
        let title = daily_title(now);
        let path = self.root.join(format!("{}.md", sanitize_filename(&title)));
        if path.is_file() {
            // 既にあるものへ印を埋め直さない。書いた内容が唯一の真実（T1）
            return Ok(NewNote { path, cursor: None });
        }
        let source = self.templates_dir().join(DAILY_TEMPLATE);
        let body = fs::read_to_string(&source)
            .map(|text| template_body(&text))
            .unwrap_or_else(|_| format!("# {title}\n\n"));
        let filled = expand(&body, now, &title);
        let path = self.create_with(&title, &filled.text)?;
        Ok(NewNote {
            path,
            cursor: filled.cursor,
        })
    }

    fn inside_templates(&self, path: &Path) -> bool {
        match (path.canonicalize(), self.templates_dir().canonicalize()) {
            (Ok(resolved), Ok(dir)) => resolved.starts_with(dir),
            _ => false,
        }
    }

    // ------------------------------------------------------------ フォルダ（ADR-0024）

    /// vault の中のフォルダ（vault からの相対・名前順）。
    ///
    /// **ディスクから引く。** 索引（ノートのパス）から作ると空フォルダが
    /// 見えず、「作ったのに出てこない」になる。除くものは `scan()` と
    /// 同じ（予約フォルダ・隠しフォルダ・外へ出るリンク）。
    pub fn folders(&self) -> Vec<String> {
        let mut found = Vec::new();
        if !self.root.is_dir() {
            return found;
        }
        let mut ancestors = HashSet::new();
        if let Ok(real) = self.root.canonicalize() {
            ancestors.insert(real);
        }
        self.walk_folders(&self.root, &ancestors, &mut found);
        found.sort();
        found
    }

    fn walk_folders(
        &self,
        directory: &Path,
        ancestors: &HashSet<PathBuf>,
        found: &mut Vec<String>,
    ) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for entry in paths {
            if !entry.is_dir() {
                continue;
            }
            let name = entry.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if SKIP_DIRS.contains(&name) || name.starts_with('.') {
                continue;
            }
            let is_symlink = entry
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);
            if is_symlink && !self.inside(&entry) {
                continue;
            }
            let Ok(real) = entry.canonicalize() else {
                continue;
            };
            if ancestors.contains(&real) {
                continue; // 祖先へ戻るリンク（scan と同じ理由）
            }
            if let Ok(relative) = entry.strip_prefix(&self.root) {
                found.push(relative.to_string_lossy().into_owned());
            }
            let mut next = ancestors.clone();
            next.insert(real);
            self.walk_folders(&entry, &next, found);
        }
    }

    /// 受け取ったフォルダ名を vault からの相対へ整える。
    ///
    /// **生の名前で先に弾く。** `sanitize_filename` は先頭のドットを剥ぐので、
    /// 後で調べると `.trash` が `trash` に化けてすり抜ける。
    fn folder_relative(&self, folder: &str) -> io::Result<String> {
        let raw: Vec<&str> = folder
            .split('/')
            .map(|part| part.trim())
            .filter(|part| !part.is_empty())
            .collect();
        if raw.contains(&"..") {
            return Err(outside_error("vault の外には出られない", Path::new(folder)));
        }
        if let Some(first) = raw.first() {
            if SKIP_DIRS.contains(first) || first.starts_with('.') {
                return Err(outside_error("予約フォルダは使えない", Path::new(folder)));
            }
        }
        Ok(raw
            .into_iter()
            .map(sanitize_filename)
            .collect::<Vec<String>>()
            .join("/"))
    }

    /// フォルダを作る。作った場所を返す。
    ///
    /// 既にあるときは失敗する。黙って受けると「作った」の知らせが嘘になる
    /// （別の場所を作ったと誤解させる）。
    pub fn create_folder(&self, folder: &str) -> io::Result<PathBuf> {
        let cleaned = self.folder_relative(folder)?;
        if cleaned.is_empty() {
            return Err(invalid("フォルダの名前が空"));
        }
        let target = self.root.join(&cleaned);
        if target.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("同じ名前のフォルダがあります: {cleaned}"),
            ));
        }
        fs::create_dir_all(&target)?;
        Ok(target)
    }

    /// フォルダの名前を変える。新しい相対パスを返す。
    ///
    /// **中身は触らない。** ディレクトリの名前を変えるだけなので、中の
    /// ノートは 1 バイトも変わらない。**親も変えない**（動かすのは移動の仕事）。
    /// 既に同じ名前があれば失敗する — 黙って中身が合流すると、どちらの
    /// ノートだったのか分からなくなる。
    pub fn rename_folder(&self, folder: &str, name: &str) -> io::Result<String> {
        let cleaned = self.folder_relative(folder)?;
        if cleaned.is_empty() {
            return Err(invalid("フォルダの名前が空"));
        }
        let source = self.root.join(&cleaned);
        if !source.is_dir() {
            return Err(invalid(&format!("フォルダが無い: {folder}")));
        }
        // **空は先に断る。** sanitize_filename は「無題」を返すので、通すと
        // 打ち間違いが「無題」というフォルダになる
        let typed = name.trim();
        if typed.is_empty() {
            return Err(invalid("新しい名前が空"));
        }
        // 名前は 1 段ぶん。`/` を打たれても階層は増やさない（移動ではない）
        let new_name = sanitize_filename(&typed.replace('/', "-"));
        let parent = match cleaned.rsplit_once('/') {
            Some((head, _)) => format!("{head}/"),
            None => String::new(),
        };
        let renamed = format!("{parent}{new_name}");
        // 予約フォルダの名前は使わせない（`.trash` へ化けさせない）
        if self.folder_relative(&renamed)? != renamed {
            return Err(invalid(&format!("その名前は使えません: {typed}")));
        }
        let target = self.root.join(&renamed);
        if target == source {
            return Ok(cleaned);
        }
        if target.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("同じ名前のフォルダがあります: {renamed}"),
            ));
        }
        fs::rename(&source, &target)?;
        Ok(renamed)
    }

    /// フォルダを消す。
    ///
    /// **ノートが 1 つでも入っていたら消さない。** フォルダの削除にゴミ箱は
    /// 無いので、中身ごと消える操作は用意しない。空のフォルダ（中が空
    /// フォルダだけ、も含む）だけを消す。macOS が置く `.DS_Store` は無視する。
    pub fn delete_folder(&self, folder: &str) -> io::Result<()> {
        let cleaned = self.folder_relative(folder)?;
        if cleaned.is_empty() {
            return Err(invalid("フォルダの名前が空"));
        }
        let target = self.root.join(&cleaned);
        if !target.is_dir() {
            return Err(invalid(&format!("フォルダが無い: {folder}")));
        }
        if has_files(&target) {
            return Err(invalid(&format!("中にノートが残っている: {cleaned}")));
        }
        fs::remove_dir_all(&target)
    }

    /// ノートをフォルダへ移す。移した先を返す。空文字は直下。
    ///
    /// **本文は書き換えない（T1）。** 添付リンクは vault ルート基準で解決
    /// するので、どこへ動いても表示と書き出しは壊れない。
    /// **空になっても元のフォルダは残す**（ADR-0024 追記 2。最後のノートを
    /// 移しただけで消えると「勝手に無くなった」になる）。
    pub fn move_note(&self, path: &Path, folder: &str) -> io::Result<PathBuf> {
        if !path.exists() {
            return Err(outside_error("移すノートが見つからない", path));
        }
        if !self.inside(path) {
            return Err(outside_error("保管フォルダの外は移せない", path));
        }
        let cleaned = self.folder_relative(folder)?;
        let destination = if cleaned.is_empty() {
            self.root.clone()
        } else {
            self.root.join(&cleaned)
        };
        if path.parent() == Some(destination.as_path()) {
            return Ok(path.to_path_buf()); // 同じ場所。動かす意味が無い
        }
        fs::create_dir_all(&destination)?;
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(UNTITLED)
            .to_string();
        let suffix = match path.extension().and_then(|s| s.to_str()) {
            Some(extension) => format!(".{extension}"),
            None => ".md".to_string(),
        };
        let target = unique_path(&destination, &stem, &suffix, None);
        fs::rename(path, &target)?;
        Ok(target)
    }

    // --------------------------------------------------------------- 初回

    /// ノートが 1 つも無い vault か。
    pub fn is_empty(&self) -> bool {
        self.scan().is_empty()
    }

    /// 初回だけ使い方ノートを置く。置いたパスを返す。置かなければ None。
    ///
    /// 条件は「vault が空」かつ「まだ置いたことがない」。印を管理フォルダに
    /// 残すのは、**消したマニュアルを起動のたびに復活させない**ため。
    /// 印は消えてもよい（T7 と同じ扱い。最悪もう一度置かれるだけ）。
    pub fn seed_manual(&self) -> io::Result<Option<PathBuf>> {
        let marker = self.managed_dir().join(MANUAL_MARKER);
        if marker.exists() || !self.is_empty() {
            return Ok(None);
        }
        let placed = self.place_manual()?;
        fs::create_dir_all(self.managed_dir())?;
        fs::write(&marker, placed.to_string_lossy().as_bytes())?;
        Ok(Some(placed))
    }

    /// 使い方ノートを**今の内容で**置く（ヘルプメニューから）。
    ///
    /// アプリが新しくなって説明が増えても、既に置いたノートは古いまま残る
    /// （印があるので `seed_manual` は二度と置かない）。ここから最新の説明を
    /// 出せる道を残しておく。
    ///
    /// **既にあるノートは消さない。** 書き足したメモごと消えては困るので、
    /// 別のファイルとして置く（`unique_path` が名前をずらす）。
    pub fn place_manual(&self) -> io::Result<PathBuf> {
        self.create_with(MANUAL_TITLE, MANUAL)
    }

    /// タイトル変更に合わせてファイル名を変える。
    ///
    /// 元のフォルダに留める（参照実装 K-1: サブフォルダのノートが改名だけで
    /// vault 直下へ出ない）。同名の衝突も同じフォルダの中だけを見る。
    /// 自分自身は衝突相手にしない（APFS は大文字小文字を区別しない）。
    /// 同じ名前なら何もしない。旧名は `.trash` に残さない（改名は削除ではない）。
    pub fn rename(&self, path: &Path, title: &str) -> io::Result<PathBuf> {
        // 無いパスは inside() でも弾かれるが、「外」と報告すると紛らわしい
        // （UI の二重発火で実際に踏んだ。2026-09-04）
        if !path.exists() {
            return Err(outside_error("改名するノートが見つからない", path));
        }
        if !self.inside(path) {
            return Err(outside_error("保管フォルダの外は改名できない", path));
        }
        let folder = match path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => self.root.clone(),
        };
        let stem = sanitize_filename(title);
        if folder.join(format!("{stem}.md")) == *path {
            return Ok(path.to_path_buf()); // 同じ名前。動かす意味が無い
        }
        let target = unique_path(&folder, &stem, ".md", Some(path));
        fs::rename(path, &target)?;
        // 「名前を変更」は本文の見出しも書き換える（ADR-0005）。
        // 見出しには打った通りのタイトルが入る（ファイル名側だけ sanitize）
        if let Ok(text) = fs::read_to_string(&target) {
            let rewritten = with_title(&text, title);
            if rewritten != text {
                crate::autosave::save_atomic(&target, &rewritten)?;
            }
        }
        Ok(target)
    }

    /// 画像などを `attachments/` へ置き、その場所を返す（spec §7.1）。
    ///
    /// 名前は時刻から作る。並べたときに貼った順になるほうが、後から
    /// 探すときに手がかりになる。同名があれば連番を付けて上書きしない。
    pub fn add_attachment(&self, data: &[u8], suffix: &str) -> io::Result<PathBuf> {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        self.add_attachment_stamped(data, suffix, &stamp)
    }

    /// `add_attachment` の時刻注入版（テスト用に分離）。
    pub fn add_attachment_stamped(
        &self,
        data: &[u8],
        suffix: &str,
        stem: &str,
    ) -> io::Result<PathBuf> {
        fs::create_dir_all(self.attachments_dir())?;
        let path = unique_path(
            &self.attachments_dir(),
            stem,
            &attachment_suffix(suffix),
            None,
        );
        crate::autosave::save_bytes_atomic(&path, data)?;
        Ok(path)
    }

    /// 本文へ挿す Markdown。**vault からの相対パス**で書く。
    /// 絶対パスで書くと、保管フォルダごと移したときに全部切れる。
    pub fn attachment_link(&self, path: &Path) -> String {
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        format!("![]({})", relative.to_string_lossy().replace('\\', "/"))
    }

    /// `.trash` へ移す（spec §7.6）。
    ///
    /// 階層を保って入れる（参照実装 K-5: ファイル自身が場所を覚えているので
    /// 戻すときに元のフォルダへ帰れる）。同名があればタイムスタンプを付ける。
    /// 既にゴミ箱の中なら何もしない（入れ子の .trash/.trash/ を作らない）。
    pub fn trash(&self, path: &Path) -> io::Result<PathBuf> {
        // 境界は字句ではなく実体で見る（`.trash/../大事.md` を通さない）
        let root = self.root.canonicalize()?;
        let resolved = path
            .canonicalize()
            .map_err(|_| outside_error("保管フォルダの外は捨てられない", path))?;
        let Ok(relative) = resolved.strip_prefix(&root) else {
            return Err(outside_error("保管フォルダの外は捨てられない", path));
        };
        let mut components = relative.components();
        if components.next()
            == Some(std::path::Component::Normal(std::ffi::OsStr::new(
                TRASH_DIR,
            )))
        {
            // 既にゴミ箱の中。動かすと .trash/.trash/ へ入れ子になって
            // 戻せなくなる。望みの状態は既に満ちている
            return Ok(path.to_path_buf());
        }
        let target = self.trash_dir().join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let target = if target.exists() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let stem = target
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("無題")
                .to_string();
            let suffix = target
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| format!(".{s}"))
                .unwrap_or_default();
            let parent = target.parent().map(Path::to_path_buf).unwrap_or_default();
            // タイムスタンプでも衝突したら（同一秒に 2 回捨てた）連番で逃がす
            unique_path(&parent, &format!("{stem}-{stamp}"), &suffix, None)
        } else {
            target
        };
        fs::rename(path, &target)?;
        // purge_trash の期限は「捨ててから」数える。rename は mtime を
        // 変えないので、ここで刻み直さないと古いノートが即座に消える
        if let Ok(file) = fs::File::options().write(true).open(&target) {
            let _ = file.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now()));
        }
        Ok(target)
    }

    /// 期限を過ぎたゴミ箱の中身を消す（spec §7.6）。vault を開いたときに呼ぶ。
    ///
    /// 1 件の不調で掃除ごと投げ出さない — 同期の下では走査と stat の間に
    /// ファイルが消える（iCloud / Dropbox / 別マシンが同じ vault を触る）。
    pub fn purge_trash(&self, days: u64) -> io::Result<Vec<PathBuf>> {
        let trash = self.trash_dir();
        if !trash.is_dir() {
            return Ok(vec![]);
        }
        let deadline = std::time::SystemTime::now()
            - std::time::Duration::from_secs(days.saturating_mul(24 * 3600));
        let mut removed = Vec::new();
        let mut stack = vec![trash.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let expired = fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .map(|m| m < deadline)
                    .unwrap_or(false);
                if expired && fs::remove_file(&path).is_ok() {
                    if let Some(parent) = path.parent() {
                        prune_empty_dirs(parent, &trash.canonicalize().unwrap_or(trash.clone()));
                    }
                    removed.push(path);
                }
            }
        }
        removed.sort();
        Ok(removed)
    }

    /// ゴミ箱の中身を今すぐ全部消す（G-3）。期限を待たずに消したいことがある。
    /// 呼ぶ前に確認を取るのは UI 側の仕事。ここは黙って消す。
    pub fn empty_trash(&self) -> io::Result<Vec<PathBuf>> {
        let trash = self.trash_dir();
        if !trash.is_dir() {
            return Ok(vec![]);
        }
        let mut removed = Vec::new();
        for entry in fs::read_dir(&trash)?.flatten() {
            let path = entry.path();
            let gone = if path.is_dir() {
                fs::remove_dir_all(&path).is_ok()
            } else {
                fs::remove_file(&path).is_ok()
            };
            if gone {
                removed.push(path);
            }
        }
        removed.sort();
        Ok(removed)
    }

    /// ゴミ箱の中の 1 件を完全に消す（G-3）。
    ///
    /// **ゴミ箱の外は消さない。** 保管フォルダのノートを直に消す道を作ると、
    /// 押し間違いが取り返しのつかない結果になる。既に無ければ何もしない。
    pub fn delete_permanently(&self, path: &Path) -> io::Result<()> {
        let trash = self
            .trash_dir()
            .canonicalize()
            .map_err(|_| io::Error::new(io::ErrorKind::NotFound, "ゴミ箱がまだ無い".to_string()))?;
        // 字句上の判定は `.trash/../メモ.md` を通す。実体で見る
        match path.canonicalize() {
            Ok(resolved) => {
                if resolved == trash || !resolved.starts_with(&trash) {
                    return Err(outside_error("ゴミ箱の外は消せない", path));
                }
                fs::remove_file(&resolved)?;
                if let Some(parent) = resolved.parent() {
                    prune_empty_dirs(parent, &trash);
                }
                Ok(())
            }
            // 実体が無い = 既に消えている。続けて押したときに落ちない。
            // ただし字句上でもゴミ箱の中を指していることだけは確かめる
            Err(_) => {
                if path.starts_with(self.trash_dir()) && !path.to_string_lossy().contains("..") {
                    Ok(())
                } else {
                    Err(outside_error("ゴミ箱の外は消せない", path))
                }
            }
        }
    }

    /// ゴミ箱の中の Markdown ファイルを名前順で返す。
    ///
    /// `scan()` は `.trash` を除くので、こちらは専用の走査。ゴミ箱の中は
    /// こちらが作った階層なので、除外規則もリンク追跡も要らない
    /// （シンボリックリンクは辿らない）。
    pub fn trash_list(&self) -> Vec<PathBuf> {
        let mut found = Vec::new();
        collect_markdown(&self.trash_dir(), &mut found);
        found
    }

    /// ゴミ箱から元のフォルダへ戻す（参照実装 K-5）。
    ///
    /// `.trash/` の中の位置がそのまま元の位置。フォルダが消えていたら
    /// 作り直す（捨てる前には在ったのだから、戻すのに要る）。
    /// 戻したあと、ゴミ箱の中に空の殻を残さない。
    pub fn restore(&self, path: &Path) -> io::Result<PathBuf> {
        let trash = self.trash_dir().canonicalize()?;
        let resolved = path
            .canonicalize()
            .map_err(|_| outside_error("ゴミ箱の中だけ戻せる", path))?;
        let Ok(relative) = resolved.strip_prefix(&trash) else {
            return Err(outside_error("ゴミ箱の中だけ戻せる", path));
        };
        if relative.as_os_str().is_empty() {
            return Err(outside_error("ゴミ箱の中だけ戻せる", path));
        }
        let destination = match relative.parent() {
            Some(parent) => self.root.join(parent),
            None => self.root.clone(),
        };
        fs::create_dir_all(&destination)?;
        let stem = resolved
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(UNTITLED);
        let suffix = resolved
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{s}"))
            .unwrap_or_default();
        let target = unique_path(&destination, stem, &suffix, None);
        fs::rename(&resolved, &target)?;
        if let Some(parent) = resolved.parent() {
            prune_empty_dirs(parent, &trash);
        }
        Ok(target)
    }
}

/// 空になったフォルダを `boundary` の手前まで遡って消す。
///
/// ゴミ箱の中だけで使う。ユーザーに見えるフォルダは空でも残す
/// （ADR-0024）。完全に空のときだけ消す。
fn prune_empty_dirs(start: &Path, boundary: &Path) {
    let mut probe = start.to_path_buf();
    loop {
        let Ok(resolved) = probe.canonicalize() else {
            return;
        };
        if resolved == *boundary || !resolved.starts_with(boundary) {
            return;
        }
        match fs::read_dir(&resolved) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    return; // 空ではない
                }
            }
            Err(_) => return,
        }
        if fs::remove_dir(&resolved).is_err() {
            return;
        }
        match probe.parent() {
            Some(parent) => probe = parent.to_path_buf(),
            None => return,
        }
    }
}

/// リンクを辿らずに Markdown ファイルだけを名前順で集める（ゴミ箱用）。
fn collect_markdown(directory: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for entry in paths {
        let is_symlink = entry
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true);
        if is_symlink {
            continue;
        }
        if entry.is_dir() {
            collect_markdown(&entry, found);
        } else if is_markdown(&entry) {
            found.push(entry);
        }
    }
}

/// 雛形の本文（front matter を外したもの）。
///
/// **雛形の front matter は持ち込まない。** ピン留めのような管理情報は
/// 雛形の持ち物で、そこから作るノートの持ち物ではない（参照実装も同じ）。
fn template_body(text: &str) -> String {
    match crate::front_matter::block_len(text) {
        Some(len) => text[len..].to_string(),
        None => text.to_string(),
    }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}

/// フォルダの中（子孫も含む）にファイルが残っているか。
/// macOS が勝手に置く `.DS_Store` は「残っている」に数えない。
fn has_files(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return true; // 読めないなら安全側（消さない）
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if has_files(&path) {
                return true;
            }
        } else if path.file_name().and_then(|name| name.to_str()) != Some(IGNORED_FILE) {
            return true;
        }
    }
    false
}

fn outside_error(message: &str, path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{message}: {}", path.display()),
    )
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_SUFFIXES.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// タイトルをファイル名に使える形へ直す（spec §7.1）。
///
/// NFC 正規化 → 制御文字を除去 → `/:\` を `-` に → 空白を 1 つに畳む →
/// 先頭のドットを剥がす（隠しファイル化を防ぐ）→ 200 バイト以内に切り詰め。
/// 空になったら「無題」。
pub fn sanitize_filename(title: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let mut text = String::new();
    for character in title.nfc() {
        // Python の isprintable 相当の近似: 制御文字（空白は残す）と
        // 不可視の書式文字（ZWSP や BOM など）を落とす
        if (character.is_control() && !character.is_whitespace()) || is_format_char(character) {
            continue;
        }
        // パス区切りと、Finder が嫌う `:` をハイフンに
        if matches!(character, '/' | ':' | '\\') {
            text.push('-');
        } else {
            text.push(character);
        }
    }
    // 空白を 1 つに畳んで前後を落とし、先頭のドットを剥がす（隠しファイル化を防ぐ）
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut result = collapsed.trim_start_matches('.').trim().to_string();
    while result.len() > MAX_FILENAME_BYTES {
        result.pop();
    }
    if result.is_empty() {
        UNTITLED.to_string()
    } else {
        result
    }
}

fn is_format_char(character: char) -> bool {
    matches!(
        character,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{FEFF}'
    )
}

fn is_same_file(candidate: &Path, other: Option<&Path>) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Some(other) = other else {
        return false;
    };
    // 同じ実体を指しているか。名前ではなく実体で見る（APFS の既定は
    // 大文字小文字を区別しないので、名前を比べると別物に見える）
    match (fs::metadata(candidate), fs::metadata(other)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// 重複しないパスを返す。衝突したら `-2`, `-3` を付ける（spec §7.1）。
///
/// `ignoring` に動かそうとしている当人を渡すと、それは衝突と数えない。
/// 渡さないと、大文字小文字だけ変えた改名で自分自身を衝突相手と見て
/// `-2` が付く（APFS は大文字小文字を区別しないため）。
pub fn unique_path(directory: &Path, stem: &str, suffix: &str, ignoring: Option<&Path>) -> PathBuf {
    let mut candidate = directory.join(format!("{stem}{suffix}"));
    let mut index = 2;
    while candidate.exists() && !is_same_file(&candidate, ignoring) {
        candidate = directory.join(format!("{stem}-{index}{suffix}"));
        index += 1;
    }
    candidate
}

/// 貼り付け元から来た拡張子を、ファイル名に使える形へ直す。
///
/// クリップボードやドロップ元の文字列をそのまま繋ぐと、`../` や空白で
/// attachments の外へ書ける。英数字だけ残す（参照実装 attachment_suffix）。
pub fn attachment_suffix(raw: &str) -> String {
    let tail = raw.rsplit('.').next().unwrap_or("");
    let cleaned: String = tail
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if cleaned.is_empty() {
        ".png".to_string()
    } else {
        format!(".{cleaned}")
    }
}

/// 競合コピーの置き場を決める（spec §7.5 の「両方残す」）。
/// `名前 (競合 YYYY-MM-DD).md` の形。同名があれば連番で逃がす。
pub fn conflict_copy_path(path: &Path, date: &str) -> PathBuf {
    let folder = path.parent().unwrap_or(Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(UNTITLED);
    unique_path(folder, &format!("{stem} (競合 {date})"), ".md", None)
}

/// タイトルを付け替えた本文を返す（ADR-0005）。
///
/// タイトルは本文から導かれるので、本文を書き換えるのが唯一の付け替え方。
/// - 見出しがあれば、その行の文字だけを差し替える（深さは保つ）
/// - 見出しが無ければ本文の先頭に `# タイトル` を足す
/// - front matter とコードフェンスの中は見出しとして扱わない
pub fn with_title(text: &str, title: &str) -> String {
    // 見出しは 1 行。改行や連続空白を持ち込ませない
    let cleaned = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return text.to_string();
    }

    let lines: Vec<&str> = text.split('\n').collect();
    let mut in_front_matter = false;
    let mut in_fence = false;
    let mut heading: Option<usize> = None;
    for (number, line) in lines.iter().enumerate() {
        if number == 0 && line.trim_end() == "---" {
            in_front_matter = true;
            continue;
        }
        if in_front_matter {
            if line.trim_end() == "---" {
                in_front_matter = false;
            }
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes)
            && line[hashes..].starts_with(' ')
            && !line[hashes..].trim().is_empty()
        {
            heading = Some(number);
            break;
        }
    }

    match heading {
        Some(number) => {
            let hashes = lines[number].chars().take_while(|c| *c == '#').count();
            let mut replaced = lines.clone();
            let marker = &lines[number][..hashes];
            let new_line = format!("{marker} {cleaned}");
            replaced[number] = &new_line;
            replaced.join("\n")
        }
        None => {
            if text.trim().is_empty() {
                format!("# {cleaned}\n")
            } else {
                format!("# {cleaned}\n\n{text}")
            }
        }
    }
}

/// `candidate` が vault の中に留まるか。Tauri commands の入口で必ず通す。
///
/// 実在する部分を canonicalize して判定する（シンボリックリンク越しの
/// 脱出や `..` を防ぐ）。ファイル自体がまだ無ければ親フォルダで判定する
/// （新規保存の経路）。判定の規則は `inside` と同じ「外を指すものは扱わない」。
pub fn contains(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let target = if candidate.exists() {
        candidate.to_path_buf()
    } else {
        match candidate.parent() {
            Some(parent) => parent.to_path_buf(),
            None => return false,
        }
    };
    match target.canonicalize() {
        Ok(resolved) => resolved.starts_with(&root),
        Err(_) => false,
    }
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

    /// テスト用: ファイルの mtime を「日数」だけ過去にずらす。
    fn age_file(path: &Path, days: u64) {
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(days * 24 * 3600);
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(past))
            .unwrap();
    }

    fn mtime(path: &Path) -> std::time::SystemTime {
        std::fs::metadata(path).unwrap().modified().unwrap()
    }

    #[test]
    fn test_trash_捨てた直後のmtimeは今になる() {
        // rename は mtime を保つので、刻み直さないと古いノートが
        // purge_trash で即座に消える（参照実装と同じ約束）
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = note(root.path(), "古い.md");
        age_file(&path, 90);

        let target = vault.trash(&path).unwrap();
        let elapsed = mtime(&target).elapsed().unwrap();
        assert!(elapsed < std::time::Duration::from_secs(60));
    }

    #[test]
    fn test_purge_trash_期限を過ぎたものだけ消して空の殻も残さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let old = note(root.path(), &format!("{TRASH_DIR}/sub/古い.md"));
        let fresh = note(root.path(), &format!("{TRASH_DIR}/新しい.md"));
        age_file(&old, 31);

        let removed = vault.purge_trash(30).unwrap();
        assert_eq!(removed, vec![old.clone()]);
        assert!(!old.exists());
        assert!(!old.parent().unwrap().exists(), "空の殻を残さない");
        assert!(fresh.exists());
    }

    #[test]
    fn test_purge_trash_ゴミ箱が無ければ何もしない() {
        let root = TempDir::new().unwrap();
        assert_eq!(
            Vault::new(root.path()).purge_trash(30).unwrap(),
            Vec::<PathBuf>::new()
        );
    }

    #[test]
    fn test_empty_trash_期限を待たずに全部消す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let a = note(root.path(), &format!("{TRASH_DIR}/a.md"));
        let b = note(root.path(), &format!("{TRASH_DIR}/sub/b.md"));
        let keep = note(root.path(), "残る.md");

        vault.empty_trash().unwrap();
        assert!(!a.exists());
        assert!(!b.exists());
        assert!(keep.exists(), "ゴミ箱の外は触らない");
    }

    #[test]
    fn test_delete_permanently_ゴミ箱の1件だけ消して殻を残さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let gone = note(root.path(), &format!("{TRASH_DIR}/sub/消す.md"));
        let keep = note(root.path(), &format!("{TRASH_DIR}/残す.md"));

        vault.delete_permanently(&gone).unwrap();
        assert!(!gone.exists());
        assert!(!gone.parent().unwrap().exists());
        assert!(keep.exists());
    }

    #[test]
    fn test_delete_permanently_ゴミ箱の外は消さずにエラー() {
        // 押し間違いが取り返しのつかない結果にならないための境界
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let alive = note(root.path(), "生きている.md");
        assert!(vault.delete_permanently(&alive).is_err());
        assert!(alive.exists());
        let sneaky = root.path().join(format!("{TRASH_DIR}/../生きている.md"));
        assert!(vault.delete_permanently(&sneaky).is_err());
        assert!(alive.exists());
    }

    #[test]
    fn test_delete_permanently_既に無ければ何もしない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let gone = vault.trash_dir().join("無い.md");
        assert!(vault.delete_permanently(&gone).is_ok());
    }

    #[test]
    fn test_attachment_suffix_英数字だけ残して小文字にする() {
        assert_eq!(attachment_suffix("PNG"), ".png");
        assert_eq!(attachment_suffix(".JPEG"), ".jpeg");
        assert_eq!(attachment_suffix("photo.HEIC"), ".heic");
    }

    #[test]
    fn test_attachment_suffix_危険な文字は取り除く() {
        // パス区切りや空白で attachments の外へ書けてはいけない
        assert_eq!(attachment_suffix("p n/g"), ".png");
        assert_eq!(attachment_suffix("../../etc"), ".etc");
    }

    #[test]
    fn test_attachment_suffix_空なら既定のpng() {
        assert_eq!(attachment_suffix(""), ".png");
        assert_eq!(attachment_suffix("！？"), ".png");
    }

    #[test]
    fn test_add_attachment_attachmentsへ書いて中身が一致する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let saved = vault.add_attachment(b"\x89PNG data", "png").unwrap();
        assert_eq!(saved.parent().unwrap(), vault.attachments_dir());
        assert_eq!(std::fs::read(&saved).unwrap(), b"\x89PNG data");
    }

    #[test]
    fn test_add_attachment_同名でも上書きせず連番で逃がす() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let first = vault
            .add_attachment_stamped(b"a", "png", "20260903-120000")
            .unwrap();
        let second = vault
            .add_attachment_stamped(b"b", "png", "20260903-120000")
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), b"a");
        assert_eq!(std::fs::read(&second).unwrap(), b"b");
    }

    #[test]
    fn test_attachment_link_vaultからの相対パスで書く() {
        // 絶対パスで書くと保管フォルダごと移したときに全部切れる
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let saved = vault.add_attachment(b"x", "png").unwrap();
        let link = vault.attachment_link(&saved);
        let name = saved.file_name().unwrap().to_str().unwrap();
        assert_eq!(link, format!("![]({ATTACHMENTS_DIR}/{name})"));
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

    #[test]
    fn test_contains_中のファイルは通し外のファイルは弾く() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let inner = note(root.path(), "sub/a.md");
        let escape = note(outside.path(), "b.md");

        assert!(contains(root.path(), &inner));
        assert!(!contains(root.path(), &escape));
    }

    #[test]
    fn test_contains_ドットドットでの脱出を弾く() {
        let root = TempDir::new().unwrap();
        let outside = note(root.path().parent().unwrap(), "escape.md");
        let sneaky = root.path().join("..").join(outside.file_name().unwrap());
        assert!(!contains(root.path(), &sneaky));
    }

    #[test]
    fn test_contains_外を指すリンク越しの書き込みを弾く() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), root.path().join("linkdir")).unwrap();

        assert!(!contains(root.path(), &root.path().join("linkdir/x.md")));
    }

    #[test]
    fn test_contains_まだ無いファイルは親フォルダで判定する() {
        let root = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("sub")).unwrap();

        assert!(contains(root.path(), &root.path().join("sub/new.md")));
        assert!(!contains(root.path(), Path::new("/no/such/dir/new.md")));
    }

    #[test]
    fn test_sanitize_日本語のタイトルはそのまま通る() {
        assert_eq!(sanitize_filename("会議の記録"), "会議の記録");
    }

    #[test]
    fn test_sanitize_パス区切りとコロンをハイフンに変える() {
        assert_eq!(sanitize_filename("a/b:c\\d"), "a-b-c-d");
    }

    #[test]
    fn test_sanitize_空白を畳んで前後を落とす() {
        assert_eq!(sanitize_filename("  a \t b\n c  "), "a b c");
    }

    #[test]
    fn test_sanitize_先頭のドットを剥がす() {
        assert_eq!(sanitize_filename("...secret"), "secret");
    }

    #[test]
    fn test_sanitize_制御文字を除去する() {
        assert_eq!(sanitize_filename("a\u{0007}b\u{200B}c"), "abc");
    }

    #[test]
    fn test_sanitize_200バイトに文字境界で切り詰める() {
        let long = "あ".repeat(100); // 300 バイト
        let result = sanitize_filename(&long);
        assert!(result.len() <= 200);
        assert_eq!(result, "あ".repeat(66)); // 66 × 3 = 198 バイト
    }

    #[test]
    fn test_sanitize_空になったら無題() {
        assert_eq!(sanitize_filename("   "), "無題");
        assert_eq!(sanitize_filename("..."), "無題");
    }

    #[test]
    fn test_unique_path_衝突が無ければそのままの名前() {
        let dir = TempDir::new().unwrap();
        assert_eq!(
            unique_path(dir.path(), "a", ".md", None),
            dir.path().join("a.md")
        );
    }

    #[test]
    fn test_unique_path_衝突したら連番を付ける() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("a-2.md"), "").unwrap();
        assert_eq!(
            unique_path(dir.path(), "a", ".md", None),
            dir.path().join("a-3.md")
        );
    }

    #[test]
    fn test_unique_path_当人は衝突相手にしない() {
        let dir = TempDir::new().unwrap();
        let own = dir.path().join("a.md");
        fs::write(&own, "").unwrap();
        assert_eq!(unique_path(dir.path(), "a", ".md", Some(&own)), own);
    }

    #[test]
    fn test_create_見出し付きの新規ノートを作る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = vault.create("無題").unwrap();
        assert_eq!(path, root.path().join("無題.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# 無題\n\n");
    }

    #[test]
    fn test_create_同名があれば連番を付ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.create("無題").unwrap();
        let second = vault.create("無題").unwrap();
        assert_eq!(second, root.path().join("無題-2.md"));
    }

    #[test]
    fn test_rename_元のフォルダに留めて改名し見出しも追従する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let old = note(root.path(), "sub/旧名.md");
        let renamed = vault.rename(&old, "新名").unwrap();
        assert_eq!(renamed, root.path().join("sub/新名.md"));
        assert!(!old.exists());
        // ADR-0005: 「名前を変更」は本文の見出しも書き換える
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "# 新名\n");
    }

    #[test]
    fn test_conflict_copy_path_競合の名前を作り_同名は連番で逃がす() {
        let dir = TempDir::new().unwrap();
        let base = note(dir.path(), "会議.md");
        let copy = conflict_copy_path(&base, "2026-09-04");
        assert_eq!(copy, dir.path().join("会議 (競合 2026-09-04).md"));

        note(dir.path(), "会議 (競合 2026-09-04).md");
        let second = conflict_copy_path(&base, "2026-09-04");
        assert_eq!(second, dir.path().join("会議 (競合 2026-09-04)-2.md"));
    }

    #[test]
    fn test_with_title_見出しの行だけ差し替えて深さを保つ() {
        assert_eq!(with_title("## 旧題\n\n本文\n", "新題"), "## 新題\n\n本文\n");
    }

    #[test]
    fn test_with_title_見出しが無ければ先頭に足す() {
        assert_eq!(with_title("本文だけ\n", "新題"), "# 新題\n\n本文だけ\n");
        assert_eq!(with_title("", "新題"), "# 新題\n");
    }

    #[test]
    fn test_with_title_フェンスとfront_matterの中は見出しではない() {
        let text = "---\ntags: [a]\n---\n```\n# コード\n```\n\n# 本物\n";
        let expected = "---\ntags: [a]\n---\n```\n# コード\n```\n\n# 新題\n";
        assert_eq!(with_title(text, "新題"), expected);
    }

    #[test]
    fn test_with_title_改行入りは1行に畳み_空なら原文のまま() {
        assert_eq!(with_title("# 旧\n", "新\nしい  題"), "# 新 しい 題\n");
        assert_eq!(with_title("# 旧\n", "   "), "# 旧\n");
    }

    #[test]
    fn test_rename_同じ名前なら何もしない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = note(root.path(), "同じ.md");
        assert_eq!(vault.rename(&path, "同じ").unwrap(), path);
        assert!(path.exists());
    }

    #[test]
    fn test_rename_衝突したら連番を付ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        note(root.path(), "先客.md");
        let old = note(root.path(), "旧名.md");
        let renamed = vault.rename(&old, "先客").unwrap();
        assert_eq!(renamed, root.path().join("先客-2.md"));
    }

    #[test]
    fn test_rename_無いファイルは見つからないと報告する() {
        // 実機の回帰: UI の二重発火で 2 回目の改名が「保管フォルダの外」
        // という紛らわしいエラーになっていた（2026-09-04）
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let gone = root.path().join("もう無い.md");
        let error = vault.rename(&gone, "新名").unwrap_err();
        assert!(error.to_string().contains("見つからない"), "{error}");
    }

    #[test]
    fn test_rename_vault外は拒否する() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = note(outside.path(), "外.md");
        let vault = Vault::new(root.path());
        assert!(vault.rename(&escape, "新名").is_err());
        assert!(escape.exists());
    }

    #[test]
    fn test_trash_階層を保ってゴミ箱へ移す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let path = note(root.path(), "sub/捨てる.md");
        let moved = vault.trash(&path).unwrap();
        assert_eq!(moved, vault.trash_dir().join("sub/捨てる.md"));
        assert!(!path.exists());
        assert!(moved.exists());
    }

    #[test]
    fn test_trash_同名があればタイムスタンプを付ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let first = note(root.path(), "同名.md");
        vault.trash(&first).unwrap();
        let second = note(root.path(), "同名.md");
        let moved = vault.trash(&second).unwrap();
        assert_ne!(moved, vault.trash_dir().join("同名.md"));
        let name = moved.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("同名-") && name.ends_with(".md"));
    }

    #[test]
    fn test_trash_既にゴミ箱の中なら動かさない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let path = note(root.path(), "x.md");
        let moved = vault.trash(&path).unwrap();
        assert_eq!(vault.trash(&moved).unwrap(), moved);
        assert!(moved.exists());
    }

    #[test]
    fn test_trash_vault外は拒否する() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = note(outside.path(), "外.md");
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        assert!(vault.trash(&escape).is_err());
        assert!(escape.exists());
    }

    #[test]
    fn test_trash_list_ゴミ箱の中の階層ごとノートを名前順で返す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let a = vault.trash(&note(root.path(), "a.md")).unwrap();
        let inner = vault.trash(&note(root.path(), "sub/inner.md")).unwrap();
        note(root.path(), "生きている.md"); // ゴミ箱の外は入らない

        assert_eq!(vault.trash_list(), vec![a, inner]);
    }

    #[test]
    fn test_trash_list_ゴミ箱が無ければ空() {
        let root = TempDir::new().unwrap();
        assert_eq!(Vault::new(root.path()).trash_list(), Vec::<PathBuf>::new());
    }

    #[test]
    fn test_restore_元のフォルダへ戻しフォルダが消えていれば作り直す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let moved = vault.trash(&note(root.path(), "sub/a.md")).unwrap();
        fs::remove_dir(root.path().join("sub")).unwrap(); // 元フォルダが消えた状況

        let restored = vault.restore(&moved).unwrap();

        assert_eq!(restored, root.path().join("sub/a.md"));
        assert!(restored.exists());
        // ゴミ箱の中に空の殻（.trash/sub/）を残さない
        assert!(!vault.trash_dir().join("sub").exists());
        assert!(vault.trash_dir().exists()); // ゴミ箱自体は消さない
    }

    #[test]
    fn test_restore_同名があれば連番を付ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let moved = vault.trash(&note(root.path(), "a.md")).unwrap();
        note(root.path(), "a.md"); // 同名の後継が生まれている

        let restored = vault.restore(&moved).unwrap();
        assert_eq!(restored, root.path().join("a-2.md"));
    }

    #[test]
    fn test_restore_ゴミ箱の外は拒否する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let alive = note(root.path(), "生きている.md");
        assert!(vault.restore(&alive).is_err());
        assert!(alive.exists());
    }

    // ------------------------------------------------------- テンプレート（E-4）

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        use chrono::TimeZone;
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn test_templates_雛形を名前順で返し_走査には出さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::write(vault.templates_dir().join("議事録.md"), "# {{title}}\n").unwrap();
        fs::write(vault.templates_dir().join("日報.md"), "# {{date}}\n").unwrap();
        fs::write(vault.templates_dir().join("メモ.txt"), "雛形ではない").unwrap();

        let found = vault.templates();

        assert_eq!(
            found,
            // 名前順はコードポイント順（日 < 議）
            vec![
                vault.templates_dir().join("日報.md"),
                vault.templates_dir().join("議事録.md"),
            ]
        );
        // 雛形はノートではない。一覧に出ると本物のノートに混ざる
        assert!(vault.scan().is_empty());
    }

    #[test]
    fn test_seed_templates_初回だけ置く_手で消したものは復活しない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        let placed = vault.seed_templates().unwrap();
        assert_eq!(placed.len(), DEFAULT_TEMPLATES.len());
        assert!(vault.templates_dir().join("日次.md").is_file());

        // 2 回目は何も置かない
        assert!(vault.seed_templates().unwrap().is_empty());

        // 手で消した雛形は復活しない（印に名前が残っているため）
        fs::remove_file(vault.templates_dir().join("日次.md")).unwrap();
        assert!(vault.seed_templates().unwrap().is_empty());
        assert!(!vault.templates_dir().join("日次.md").exists());
    }

    #[test]
    fn test_seed_templates_手で直した雛形を上書きしない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::create_dir_all(vault.templates_dir()).unwrap();
        fs::write(vault.templates_dir().join("日次.md"), "# 自分の日次\n").unwrap();

        vault.seed_templates().unwrap();

        let kept = fs::read_to_string(vault.templates_dir().join("日次.md")).unwrap();
        assert_eq!(kept, "# 自分の日次\n");
    }

    #[test]
    fn test_create_from_template_印を埋めてノートを作る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let template = vault.templates_dir().join("議事録.md");
        fs::write(&template, "# {{title}}\n\n{{date}}\n\n- {{cursor}}\n").unwrap();

        let made = vault
            .create_from_template(&template, "定例会", &at(2026, 9, 3, 14, 5))
            .unwrap();

        assert_eq!(made.path, root.path().join("定例会.md"));
        let text = fs::read_to_string(&made.path).unwrap();
        assert_eq!(text, "# 定例会\n\n2026-09-03\n\n- \n");
        assert_eq!(made.cursor, Some(text.encode_utf16().count() - 1));
    }

    #[test]
    fn test_create_from_template_題名を省いたら雛形の名前() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let template = vault.templates_dir().join("議事録.md");
        fs::write(&template, "# {{title}}\n").unwrap();

        let made = vault
            .create_from_template(&template, "", &at(2026, 9, 3, 14, 5))
            .unwrap();

        assert_eq!(made.path, root.path().join("議事録.md"));
        assert_eq!(fs::read_to_string(&made.path).unwrap(), "# 議事録\n");
    }

    #[test]
    fn test_create_from_template_雛形のfront_matterは持ち込まない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let template = vault.templates_dir().join("議事録.md");
        // 管理情報（ピン留めなど）は雛形の持ち物で、ノートの持ち物ではない
        fs::write(&template, "---\npinned: true\n---\n# {{title}}\n").unwrap();

        let made = vault
            .create_from_template(&template, "定例会", &at(2026, 9, 3, 14, 5))
            .unwrap();

        assert_eq!(fs::read_to_string(&made.path).unwrap(), "# 定例会\n");
    }

    #[test]
    fn test_create_from_template_雛形の外のパスは拒否する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let outside = note(root.path(), "普通のノート.md");
        // パスは手で編集できる。外のファイルをノートに変えさせない
        assert!(vault
            .create_from_template(&outside, "x", &at(2026, 9, 3, 14, 5))
            .is_err());
    }

    #[test]
    fn test_daily_note_同じ日に何度呼んでも同じノート() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::write(
            vault.templates_dir().join(DAILY_TEMPLATE),
            "# {{date}}\n\n- [ ] {{cursor}}\n",
        )
        .unwrap();
        let now = at(2026, 9, 3, 14, 5);

        let first = vault.daily_note(&now).unwrap();
        assert_eq!(first.path, root.path().join("2026-09-03.md"));
        assert_eq!(
            fs::read_to_string(&first.path).unwrap(),
            "# 2026-09-03\n\n- [ ] \n"
        );

        // 2 つできると、どちらに書いたか分からなくなる
        let again = vault.daily_note(&now).unwrap();
        assert_eq!(again.path, first.path);
        assert_eq!(again.cursor, None); // 既にあるものへ印を埋め直さない（T1）
        assert_eq!(vault.scan().len(), 1);
    }

    #[test]
    fn test_daily_note_雛形が無ければ見出しだけ() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        let made = vault.daily_note(&at(2026, 9, 3, 14, 5)).unwrap();

        assert_eq!(fs::read_to_string(&made.path).unwrap(), "# 2026-09-03\n\n");
    }

    #[test]
    fn test_seed_manual_空のvaultに一度だけ置く() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        let placed = vault.seed_manual().unwrap().unwrap();
        assert_eq!(placed, root.path().join(format!("{MANUAL_TITLE}.md")));
        assert!(fs::read_to_string(&placed).unwrap().starts_with("# "));

        // 消したマニュアルを起動のたびに復活させない
        fs::remove_file(&placed).unwrap();
        assert!(vault.seed_manual().unwrap().is_none());
    }

    #[test]
    fn test_seed_manual_ノートがあるvaultには置かない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "先にあるノート.md");

        assert!(vault.seed_manual().unwrap().is_none());
    }

    #[test]
    fn test_manual_同梱の使い方ノートはタグを増やさない() {
        // 説明のための `#` は必ずインラインコードに入れる。素で書くと、
        // 置いた人のタグ一覧に説明用の語が並んでしまう
        assert_eq!(crate::tags::extract_tags(MANUAL), Vec::<String>::new());
        assert!(MANUAL.starts_with(&format!("# {MANUAL_TITLE}\n")));
    }

    #[test]
    fn test_place_manual_既にあるノートを消さずに置く() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        let first = vault.place_manual().unwrap();
        fs::write(&first, "# 書き足したメモ\n").unwrap();
        let second = vault.place_manual().unwrap();

        assert_ne!(second, first);
        assert_eq!(fs::read_to_string(&first).unwrap(), "# 書き足したメモ\n");
    }

    // ------------------------------------------------------------ フォルダ（ADR-0024）

    #[test]
    fn test_folders_ディスクから引いて予約フォルダと隠しは外す() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::create_dir_all(root.path().join("仕事/2026")).unwrap();
        fs::create_dir_all(root.path().join("日記")).unwrap();
        fs::create_dir_all(root.path().join(".隠し")).unwrap();

        // 空フォルダも見える（索引由来だと「作ったのに出てこない」になる）
        assert_eq!(
            vault.folders(),
            vec![
                "仕事".to_string(),
                "仕事/2026".to_string(),
                "日記".to_string()
            ]
        );
    }

    #[test]
    fn test_create_folder_作って既にあれば断る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        let made = vault.create_folder("仕事/2026").unwrap();

        assert_eq!(made, root.path().join("仕事/2026"));
        assert!(made.is_dir());
        // 黙って受けると「作った」の知らせが嘘になる
        assert!(vault.create_folder("仕事/2026").is_err());
    }

    #[test]
    fn test_create_folder_予約フォルダとvaultの外は断る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();

        assert!(vault.create_folder("attachments/中").is_err());
        assert!(vault.create_folder(".trash/中").is_err());
        assert!(vault.create_folder("../外").is_err());
        assert!(vault.create_folder("  ").is_err());
    }

    #[test]
    fn test_rename_folder_中身は触らず名前だけ変える() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "仕事/会議.md");

        let renamed = vault.rename_folder("仕事", "業務").unwrap();

        assert_eq!(renamed, "業務");
        assert!(root.path().join("業務/会議.md").is_file());
        assert!(!root.path().join("仕事").exists());
    }

    #[test]
    fn test_rename_folder_名前は1段ぶん_衝突は断る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::create_dir_all(root.path().join("仕事")).unwrap();
        fs::create_dir_all(root.path().join("日記")).unwrap();

        // `/` を打たれても階層は増やさない（移動ではない）
        assert_eq!(
            vault.rename_folder("仕事", "業務/2026").unwrap(),
            "業務-2026"
        );
        // 黙って中身が合流すると、どちらのノートだったのか分からなくなる
        assert!(vault.rename_folder("業務-2026", "日記").is_err());
        assert!(vault.rename_folder("業務-2026", "  ").is_err());
    }

    #[test]
    fn test_delete_folder_ノートが残っていたら消さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        note(root.path(), "仕事/会議.md");

        // フォルダの削除にゴミ箱は無い。中身ごと消える操作は用意しない
        assert!(vault.delete_folder("仕事").is_err());
        assert!(root.path().join("仕事/会議.md").is_file());
    }

    #[test]
    fn test_delete_folder_空なら消す_DS_Storeは無視する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        fs::create_dir_all(root.path().join("仕事/2026")).unwrap();
        fs::write(root.path().join("仕事/.DS_Store"), "").unwrap();

        vault.delete_folder("仕事").unwrap();

        assert!(!root.path().join("仕事").exists());
    }

    #[test]
    fn test_move_note_フォルダへ移し_無ければ作る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let source = note(root.path(), "会議.md");

        let moved = vault.move_note(&source, "仕事/2026").unwrap();

        assert_eq!(moved, root.path().join("仕事/2026/会議.md"));
        assert!(!source.exists());
        // 本文は書き換えない（T1）
        assert_eq!(fs::read_to_string(&moved).unwrap(), "# note\n");
    }

    #[test]
    fn test_move_note_直下へ戻す_同じ場所なら何もしない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let source = note(root.path(), "仕事/会議.md");

        let moved = vault.move_note(&source, "").unwrap();
        assert_eq!(moved, root.path().join("会議.md"));
        // 空になっても元のフォルダは残す（ADR-0024 追記 2）
        assert!(root.path().join("仕事").is_dir());

        assert_eq!(vault.move_note(&moved, "").unwrap(), moved);
    }

    #[test]
    fn test_move_note_同名があれば連番_予約フォルダは断る() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        let source = note(root.path(), "仕事/会議.md");
        note(root.path(), "会議.md");

        assert_eq!(
            vault.move_note(&source, "").unwrap(),
            root.path().join("会議-2.md")
        );
        assert!(vault
            .move_note(&root.path().join("会議-2.md"), "attachments")
            .is_err());
    }
}
