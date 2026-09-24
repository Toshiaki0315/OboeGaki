// 走査とフォルダ（spec §7.1）。`.md`/`.markdown` だけ拾い、`.trash`・管理フォルダ・
// attachments・templates・ドット始まりは除く。vault の外へ出るリンクは辿らない

use super::*;

/// リンクを辿らずに Markdown ファイルだけを名前順で集める（ゴミ箱用）。
pub(super) fn collect_markdown(directory: &Path, found: &mut Vec<PathBuf>) {
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

impl Vault {
    /// vault 内の Markdown ファイルをフォルダごとの名前順で返す。
    /// パスの相対部分は **NFC に揃える**（`nfc_under`）。
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
            .into_iter()
            .map(|path| nfc_under(&self.root, &path))
            .collect()
    }

    pub(super) fn walk(
        &self,
        directory: &Path,
        ancestors: &HashSet<PathBuf>,
        found: &mut Vec<PathBuf>,
    ) {
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
                if is_skipped(name) {
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
    pub(super) fn inside(&self, entry: &Path) -> bool {
        match (entry.canonicalize(), self.root.canonicalize()) {
            (Ok(resolved), Ok(root)) => resolved.starts_with(root),
            _ => false,
        }
    }

    /// まだ無い場所（これから作る・動かす先）の封じ込め。実在する最も近い親を
    /// 実体に解いて、それが vault の中かを見る
    pub(super) fn inside_or_unborn(&self, entry: &Path) -> bool {
        let mut probe = entry;
        while !probe.exists() {
            match probe.parent() {
                Some(parent) => probe = parent,
                None => return false,
            }
        }
        self.inside(probe)
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

    pub(super) fn walk_folders(
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
            if is_skipped(name) {
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
            // NFC に揃える（scan() と同じ）。Finder が作ったフォルダは read_dir
            // が NFD で返し、そのままだと索引（NFC の鍵）と噛み合わず件数が 0 に
            // 見える（監査 2026-09-17）
            if let Ok(relative) = nfc_under(&self.root, &entry).strip_prefix(&self.root) {
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
    /// 成分の検証だけ行い、**名前はそのまま**返す（既存フォルダの参照用）。
    ///
    /// 既存フォルダにサニタイズを掛けると、空白 2 つや `:` を含む
    /// フォルダが「画面に見えているのに操作できない」／移動が畳んだ
    /// 名前の別フォルダを作る、という食い違いになる（レビュー 2026-09-04）。
    pub(super) fn existing_folder_relative(&self, folder: &str) -> io::Result<String> {
        let raw: Vec<&str> = folder
            .split('/')
            .map(|part| part.trim())
            .filter(|part| !part.is_empty())
            .collect();
        if raw.contains(&"..") {
            return Err(outside_error("vault の外には出られない", Path::new(folder)));
        }
        for part in &raw {
            if SKIP_DIRS.contains(part) || part.starts_with('.') {
                return Err(outside_error("予約フォルダは使えない", Path::new(folder)));
            }
        }
        Ok(raw.join("/"))
    }

    /// **新しく作る名前**用。検証に加えて各成分をサニタイズする。
    pub(super) fn folder_relative(&self, folder: &str) -> io::Result<String> {
        let raw = self.existing_folder_relative(folder)?;
        Ok(raw
            .split('/')
            .filter(|part| !part.is_empty())
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
        // 親も**実体**で確かめる。字句検査だけだと、vault の中にある外向きの
        // シンボリックリンクの下に作れてしまう（レビュー 2026-09-24 / 21-3）
        if !self.inside_or_unborn(&target) {
            return Err(invalid(&format!("保管フォルダの外には作れない: {cleaned}")));
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
        let cleaned = self.existing_folder_relative(folder)?;
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
        // 予約フォルダの名前は使わせない（`.trash` へ化けさせない）。
        // 検査するのは**新しい成分だけ** — 親は既存の名前で、サニタイズと
        // 一致するとは限らない
        if SKIP_DIRS.contains(&new_name.as_str())
            || new_name.starts_with('.')
            || sanitize_filename(&new_name) != new_name
        {
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

    /// フォルダを別のフォルダの中へ移す（要望 2026-09-10、ADR-0024 追記 7）。
    /// `into` は vault からの相対（空文字は直下）。移した先の相対パスを返す。
    ///
    /// - 自分の中・子の中へは動かせない（フォルダが消える）
    /// - 同じ親へは「動かない」— エラーではなく今の場所を返す（落とし所を
    ///   間違えただけで断りの文を出さない）
    /// - 行き先に同名があれば断る（黙って中身が合流すると、どちらのノート
    ///   だったのか分からなくなる = rename_folder と同じ）
    pub fn move_folder(&self, folder: &str, into: &str) -> io::Result<String> {
        let cleaned = self.existing_folder_relative(folder)?;
        if cleaned.is_empty() {
            return Err(invalid("フォルダの名前が空"));
        }
        let source = self.root.join(&cleaned);
        if !source.is_dir() {
            return Err(invalid(&format!("フォルダが無い: {folder}")));
        }
        let destination = self.existing_folder_relative(into)?;
        if destination == cleaned || destination.starts_with(&format!("{cleaned}/")) {
            return Err(invalid(&format!("自分の中へは移せません: {cleaned}")));
        }
        if !destination.is_empty() && !self.root.join(&destination).is_dir() {
            return Err(invalid(&format!("行き先のフォルダが無い: {into}")));
        }
        let name = cleaned.rsplit('/').next().unwrap_or(&cleaned);
        let moved = if destination.is_empty() {
            name.to_string()
        } else {
            format!("{destination}/{name}")
        };
        if moved == cleaned {
            return Ok(cleaned);
        }
        let target = self.root.join(&moved);
        if target.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("行き先に同じ名前のフォルダがあります: {moved}"),
            ));
        }
        // 行き先も**実体**で確かめる（move_note と同じ）。外向きのシンボリック
        // リンクへ動かすと、フォルダごと vault の外へ出て索引からも消えていた
        // （レビュー 2026-09-24 / 21-3）
        if !self.inside_or_unborn(&target) {
            return Err(invalid(&format!("保管フォルダの外へは移せない: {moved}")));
        }
        fs::rename(&source, &target)?;
        Ok(moved)
    }

    /// フォルダを消す。
    ///
    /// **ノートが 1 つでも入っていたら消さない。** フォルダの削除にゴミ箱は
    /// 無いので、中身ごと消える操作は用意しない。空のフォルダ（中が空
    /// フォルダだけ、も含む）だけを消す。macOS が置く `.DS_Store` は無視する。
    pub fn delete_folder(&self, folder: &str) -> io::Result<()> {
        let cleaned = self.existing_folder_relative(folder)?;
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
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{blank_note, temp_vault};
    use std::fs;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    #[test]
    fn test_folder_既存フォルダは名前をサニタイズせずに引ける() {
        // レビュー 2026-09-04: 既存フォルダ名にも sanitize を掛けていて、
        // 空白 2 つや `:` を含むフォルダが「画面に見えているのに
        // 改名・削除できない」／move_note は畳んだ名前の**別フォルダ**を
        // 作ってそちらへ入れていた
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        fs::create_dir_all(root.path().join("仕事  資料")).unwrap();
        let note_path = blank_note(root.path(), "メモ.md");

        // 移動: 畳んだ「仕事 資料」を作らず、実在のフォルダへ入る
        let moved = vault.move_note(&note_path, "仕事  資料").unwrap();
        assert_eq!(moved, root.path().join("仕事  資料/メモ.md"));
        assert!(
            !root.path().join("仕事 資料").exists(),
            "別フォルダを作らない"
        );

        // 改名: 実在のフォルダを見つけて改名できる
        let renamed = vault.rename_folder("仕事  資料", "整理済み").unwrap();
        assert_eq!(renamed, "整理済み");
        assert!(root.path().join("整理済み/メモ.md").exists());

        // 削除: 実在の名前で消せる
        fs::create_dir_all(root.path().join("消す  対象")).unwrap();
        vault.delete_folder("消す  対象").unwrap();
        assert!(!root.path().join("消す  対象").exists());
    }

    #[test]
    fn test_folder_既存参照でも予約フォルダとドット始まりは弾く() {
        let (root, vault) = temp_vault();
        assert!(vault.delete_folder(".trash").is_err());
        assert!(vault.rename_folder(".OboeGaki", "x").is_err());
        let note_path = blank_note(root.path(), "メモ.md");
        assert!(vault.move_note(&note_path, "../外").is_err());
    }

    #[test]
    fn test_scan_NFDの名前で置かれたファイルもNFCのパスで返す() {
        let root = tempfile::tempdir().unwrap();
        let nfd_name = "フ\u{309A}ロシ\u{3099}ェクト.md";
        fs::write(root.path().join(nfd_name), "# x\n").unwrap();
        let vault = Vault::new(root.path());
        let found: Vec<String> = vault
            .scan()
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(found, vec!["プロジェクト.md".to_string()]);
        // NFC のパスでも中身は読める（APFS / HFS+ は正規化を区別しない）
        assert!(fs::read(vault.scan()[0].clone()).is_ok());
    }

    #[test]
    fn test_scan_mdとmarkdownを拾い他の拡張子を無視する() {
        let root = TempDir::new().unwrap();
        let a = blank_note(root.path(), "a.md");
        let b = blank_note(root.path(), "b.markdown");
        let c = blank_note(root.path(), "大文字.MD");
        blank_note(root.path(), "d.txt");

        // 名前順（UTF-8 バイト順）: ASCII の 2 つが先、多バイトの「大文字」が後
        assert_eq!(Vault::new(root.path()).scan(), vec![a, b, c]);
    }

    #[test]
    fn test_scan_trashと管理フォルダとドット始まりを除く() {
        let root = TempDir::new().unwrap();
        let keep = blank_note(root.path(), "sub/keep.md");
        blank_note(root.path(), &format!("{TRASH_DIR}/gone.md"));
        blank_note(root.path(), &format!("{MANAGED_DIR}/index.md"));
        blank_note(root.path(), &format!("{ATTACHMENTS_DIR}/pic.md"));
        blank_note(root.path(), &format!("{TEMPLATES_DIR}/daily.md"));
        blank_note(root.path(), ".hidden/secret.md");

        assert_eq!(Vault::new(root.path()).scan(), vec![keep]);
    }

    #[test]
    fn test_scan_フォルダごとの名前順で深さ優先に返す() {
        let root = TempDir::new().unwrap();
        let b = blank_note(root.path(), "b.md");
        let inner = blank_note(root.path(), "a-dir/inner.md");
        let a = blank_note(root.path(), "a.md");

        assert_eq!(Vault::new(root.path()).scan(), vec![inner, a, b]);
    }

    #[test]
    fn test_scan_vault外へのシンボリックリンクを辿らない() {
        let outside = TempDir::new().unwrap();
        let root = TempDir::new().unwrap();
        blank_note(outside.path(), "escape.md");
        fs::create_dir_all(outside.path().join("dir")).unwrap();
        blank_note(&outside.path().join("dir"), "in-dir.md");
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
        let a = blank_note(root.path(), "a.md");
        symlink(root.path(), root.path().join("loop")).unwrap();

        assert_eq!(Vault::new(root.path()).scan(), vec![a]);
    }

    #[test]
    fn test_folders_Finder製のNFDの名前もNFCで返す_索引の鍵と噛み合う() {
        // macOS の read_dir は NFD で作った名前を NFD のまま返す。scan() は NFC に
        // 揃えるのに folders() が揃えないと、索引（NFC）の件数が 0 になり中身も
        // 空に見える（監査 2026-09-17）
        let (root, vault) = temp_vault();
        let nfd = root.path().join("フ\u{309A}ロシ\u{3099}ェクト");
        fs::create_dir_all(&nfd).unwrap();
        fs::write(nfd.join("a.md"), "# a\n").unwrap();
        assert_eq!(vault.folders(), vec!["プロジェクト".to_string()]);
    }

    #[test]
    fn test_folders_ディスクから引いて予約フォルダと隠しは外す() {
        let (root, vault) = temp_vault();
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
        let (root, vault) = temp_vault();

        let made = vault.create_folder("仕事/2026").unwrap();

        assert_eq!(made, root.path().join("仕事/2026"));
        assert!(made.is_dir());
        // 黙って受けると「作った」の知らせが嘘になる
        assert!(vault.create_folder("仕事/2026").is_err());
    }

    #[test]
    fn test_create_folder_予約フォルダとvaultの外は断る() {
        let (_root, vault) = temp_vault();

        assert!(vault.create_folder("attachments/中").is_err());
        assert!(vault.create_folder(".trash/中").is_err());
        assert!(vault.create_folder("../外").is_err());
        assert!(vault.create_folder("  ").is_err());
    }

    #[test]
    fn test_rename_folder_中身は触らず名前だけ変える() {
        let (root, vault) = temp_vault();
        blank_note(root.path(), "仕事/会議.md");

        let renamed = vault.rename_folder("仕事", "業務").unwrap();

        assert_eq!(renamed, "業務");
        assert!(root.path().join("業務/会議.md").is_file());
        assert!(!root.path().join("仕事").exists());
    }

    #[test]
    fn test_rename_folder_名前は1段ぶん_衝突は断る() {
        let (root, vault) = temp_vault();
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
    fn test_move_folder_中身ごと別のフォルダの中へ移す_要望2026_09_10() {
        let (root, vault) = temp_vault();
        blank_note(root.path(), "仕事/会議/議事録.md");
        fs::create_dir_all(root.path().join("保管")).unwrap();

        let moved = vault.move_folder("仕事/会議", "保管").unwrap();

        assert_eq!(moved, "保管/会議");
        assert!(root.path().join("保管/会議/議事録.md").is_file());
        assert!(!root.path().join("仕事/会議").exists());
        // 直下（空文字）へも戻せる
        assert_eq!(vault.move_folder("保管/会議", "").unwrap(), "会議");
        assert!(root.path().join("会議/議事録.md").is_file());
    }

    #[test]
    fn test_move_folder_自分の中_同じ親_同名との衝突は断る() {
        let (root, vault) = temp_vault();
        blank_note(root.path(), "仕事/会議/議事録.md");
        fs::create_dir_all(root.path().join("保管/会議")).unwrap();

        assert!(vault.move_folder("仕事", "仕事").is_err()); // 自分の中
        assert!(vault.move_folder("仕事", "仕事/会議").is_err()); // 子の中
                                                                  // 同じ親へ = 動かない。エラーではなく今の場所を返す
        assert_eq!(vault.move_folder("仕事/会議", "仕事").unwrap(), "仕事/会議");
        // 行き先に同名があると中身が合流する。黙って混ぜない
        assert!(vault.move_folder("仕事/会議", "保管").is_err());
        // 無い行き先・予約フォルダは断る
        assert!(vault.move_folder("仕事", "無い").is_err());
        assert!(vault.move_folder("仕事", TRASH_DIR).is_err());
    }

    #[test]
    fn test_delete_folder_ノートが残っていたら消さない() {
        let (root, vault) = temp_vault();
        blank_note(root.path(), "仕事/会議.md");

        // フォルダの削除にゴミ箱は無い。中身ごと消える操作は用意しない
        assert!(vault.delete_folder("仕事").is_err());
        assert!(root.path().join("仕事/会議.md").is_file());
    }

    #[test]
    fn test_delete_folder_空なら消す_DS_Storeは無視する() {
        let (root, vault) = temp_vault();
        fs::create_dir_all(root.path().join("仕事/2026")).unwrap();
        fs::write(root.path().join("仕事/.DS_Store"), "").unwrap();

        vault.delete_folder("仕事").unwrap();

        assert!(!root.path().join("仕事").exists());
    }

    /// 行き先も実体で確かめる（move_note と同じ。レビュー 2026-09-24 / 21-3）。
    /// vault の中にある外向きのシンボリックリンクへ動かすと、フォルダごと外へ出ていた
    #[test]
    fn test_move_folder_シンボリックリンク越しに外へは移せない() {
        let (root, vault) = temp_vault();
        let outside = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("仕事")).unwrap();
        blank_note(root.path(), "仕事/a.md");
        symlink(outside.path(), root.path().join("linkdir")).unwrap();
        assert!(vault.move_folder("仕事", "linkdir").is_err());
        assert!(root.path().join("仕事/a.md").is_file());
        assert!(!outside.path().join("仕事").exists());
    }

    #[test]
    fn test_create_folder_シンボリックリンク越しに外へは作らない() {
        let (root, vault) = temp_vault();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), root.path().join("linkdir")).unwrap();
        assert!(vault.create_folder("linkdir/新しい").is_err());
        assert!(!outside.path().join("新しい").exists());
    }
}
