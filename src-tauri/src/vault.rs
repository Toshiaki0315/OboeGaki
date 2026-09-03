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
/// タイトルが空のときのフォールバック（参照実装 core/document.py と同じ値）。
pub const UNTITLED: &str = "無題";
/// ファイル名の上限は 255 バイト。日本語は 1 文字 3 バイトなので余裕を取る。
const MAX_FILENAME_BYTES: usize = 200;
/// 走査から外すフォルダ。watcher 側もこれを使うこと（参照実装の E-4 の教訓:
/// 2 か所に書くと「一覧には出ないのに索引には入る」食い違いが出る）。
pub(crate) const SKIP_DIRS: [&str; 4] = [TRASH_DIR, MANAGED_DIR, ATTACHMENTS_DIR, TEMPLATES_DIR];

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
        // TODO: 期限つき掃除（purge_trash）を実装するときは、ここで mtime を
        // 刻み直す（rename は mtime を変えないため「捨ててから」を数えられない）
        Ok(target)
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
}
