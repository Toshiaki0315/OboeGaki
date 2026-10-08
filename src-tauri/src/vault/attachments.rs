// 添付（attachments/）: 追加・リンクの字面・どこからも指されていないものの掃除

use super::*;

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

impl Vault {
    // --------------------------------------------------------- 添付の片づけ（E-5）
    /// どのノートからも指されていない添付。名前順。
    ///
    /// **広く数える。** 数え漏らしはそのまま画像の消失になるので、ゴミ箱の
    /// 中のノート（戻したときに絵が要る）も、雛形も、サブフォルダのノートも
    /// 見る。読めないファイルは飛ばす（1 つのせいで片づけられなくなるほうが困る）。
    ///
    /// `attachments/` 直下のファイルだけを対象にする。人が自分で作った
    /// サブフォルダと隠しファイル（`.DS_Store`）は**こちらの持ち物では
    /// ないので触らない**。
    pub fn unused_attachments(&self) -> Vec<PathBuf> {
        // 施錠ノートの中は見られない。そこだけが使う画像を「使っていない」と言うと
        // 消してしまうので、施錠ノートがあれば何も挙げない（迷ったら残す。13-3）
        if !self.scan_locked().is_empty() {
            return Vec::new();
        }
        let Ok(entries) = fs::read_dir(self.attachments_dir()) else {
            return Vec::new();
        };
        // 本文の `attachments/` の後ろを行末まで集め、ファイル名がその頭と一致すれば
        // 使っていると見る（名前を記法の区切りで切らない・大文字小文字と NFC/NFD を
        // そろえる。24-1）。迷ったら残す向きに倒す
        let mut tails: Vec<String> = Vec::new();
        for note in self.all_markdown() {
            if let Ok(text) = read_note(&note) {
                tails.extend(crate::references::attachment_tails(&text));
            }
        }
        let used = |name: &str| {
            let key = crate::references::attachment_key(name);
            tails.iter().any(|tail| tail.starts_with(&key))
        };
        let mut found: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    return false;
                };
                path.is_file() && !name.starts_with('.') && !used(name)
            })
            .collect();
        found.sort();
        found
    }

    /// 参照を数える対象。**走査（`scan`）より広い。**
    ///
    /// `scan()` はノート一覧のためのもので、ゴミ箱と雛形を外している。
    /// こちらは「消してよいか」の判定なので、そこも見る必要がある。
    pub(super) fn all_markdown(&self) -> Vec<PathBuf> {
        let mut found = self.scan();
        for directory in [self.trash_dir(), self.templates_dir()] {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            let mut stack: Vec<PathBuf> = entries
                .filter_map(|entry| entry.ok().map(|e| e.path()))
                .collect();
            while let Some(path) = stack.pop() {
                if path.is_dir() {
                    if let Ok(inner) = fs::read_dir(&path) {
                        stack.extend(inner.filter_map(|entry| entry.ok().map(|e| e.path())));
                    }
                } else if is_markdown(&path) {
                    found.push(path);
                }
            }
        }
        found
    }

    /// 添付をゴミ箱へ移す。移した先を返す。
    ///
    /// **消さない。** 判定は「本文に名前が出てこない」という消極的なもので、
    /// 取りこぼせば使用中の画像を片づけてしまう。期限のあいだは戻せる。
    ///
    /// **`attachments/` の中のものしか動かさない。** パスは呼び出し側から
    /// 来るので、ここでもう一度確かめる（ノートを片づけてしまわないため）。
    pub fn trash_attachments(&self, paths: &[PathBuf]) -> Vec<PathBuf> {
        let mut moved = Vec::new();
        for path in paths {
            if path.parent() != Some(self.attachments_dir().as_path()) || !path.is_file() {
                eprintln!("添付ではないので動かさない: {}", path.display());
                continue;
            }
            match self.trash(path) {
                Ok(target) => moved.push(target),
                Err(error) => eprintln!("添付を片づけられなかった: {error}"),
            }
        }
        moved
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
    fn add_attachment_stamped(&self, data: &[u8], suffix: &str, stem: &str) -> io::Result<PathBuf> {
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

    /// 保管フォルダの外のファイルを添付に写す（文字起こしの元の録音。ADR-0070 決定 4）。
    /// 名前は日時 + 元の拡張子。**読み込まずにファイルからファイルへ写す**（動画は大きい）。
    /// 失敗したら半端なものを残さない
    pub fn copy_attachment(&self, source: &Path) -> io::Result<PathBuf> {
        if !source.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("写すファイルがありません: {}", source.display()),
            ));
        }
        fs::create_dir_all(self.attachments_dir())?;
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let suffix = attachment_suffix(&source.to_string_lossy());
        let target = unique_path(&self.attachments_dir(), &stamp, &suffix, None);
        if let Err(error) = fs::copy(source, &target) {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        Ok(target)
    }

    /// 本文へ挿す Markdown。**vault からの相対パス**で書く。
    /// 絶対パスで書くと、保管フォルダごと移したときに全部切れる。
    pub fn attachment_link(&self, path: &Path) -> String {
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        format!("![]({})", relative.to_string_lossy().replace('\\', "/"))
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

    // ------------------------------------------------------------ 添付の片づけ（E-5）
    #[test]
    fn test_unused_attachments_どこからも指されていないものだけ() {
        let (root, vault) = temp_vault();
        for name in ["使用中.png", "孤児.png", ".DS_Store"] {
            fs::write(vault.attachments_dir().join(name), "x").unwrap();
        }
        fs::create_dir_all(vault.attachments_dir().join("自分の箱")).unwrap();
        fs::write(
            root.path().join("a.md"),
            "# a\n\n![](attachments/使用中.png)\n",
        )
        .unwrap();

        let found = vault.unused_attachments();

        assert_eq!(found, vec![vault.attachments_dir().join("孤児.png")]);
    }

    /// 使っている添付を「使われていない」と言わない（24-1）。以前は名前を空白と `)`
    /// で切り、大文字小文字と NFC/NFD を見ずに完全一致で比べていて、下の 4 つとも
    /// 未使用と答え、確かめて進むとゴミ箱へ移っていた
    #[test]
    fn test_unused_attachments_空白や括弧を含む名前_大文字小文字_分解形も使っていると数える() {
        use unicode_normalization::UnicodeNormalization;
        let (root, vault) = crate::test_support::temp_vault();
        let dir = root.path().join("attachments");
        fs::create_dir_all(&dir).unwrap();
        let decomposed: String = "データ.png".nfd().collect();
        for name in [
            "my photo.png",
            "図(1).png",
            "Photo.png",
            decomposed.as_str(),
        ] {
            fs::write(dir.join(name), b"x").unwrap();
        }
        fs::write(dir.join("本当に使っていない.png"), b"x").unwrap();
        crate::test_support::note(
            root.path(),
            "a.md",
            "![](<attachments/my photo.png>)\n![](attachments/図(1).png)\n\
             ![](attachments/photo.png)\n![](attachments/データ.png)\n",
        );
        let found: Vec<String> = vault
            .unused_attachments()
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(found, vec!["本当に使っていない.png".to_string()]);
    }

    #[test]
    fn test_unused_attachments_Shift_JIS_のノートの参照も数える() {
        // **守るはずのものを守れない**穴（7-6 の追い込み 2026-09-06）。
        // 読めないノートを飛ばすと、使っている画像が「孤児」に見えて
        // ゴミ箱へ行く
        let (root, vault) = temp_vault();
        fs::write(vault.attachments_dir().join("使用中.png"), "x").unwrap();
        let sjis = encoding_rs::SHIFT_JIS
            .encode("# 会議\n\n![](attachments/使用中.png)\n")
            .0
            .into_owned();
        fs::write(root.path().join("会議.md"), sjis).unwrap();

        assert!(vault.unused_attachments().is_empty());
    }

    #[test]
    fn test_unused_attachments_ゴミ箱と雛形の参照も数える() {
        let (_root, vault) = temp_vault();
        for name in ["ゴミ箱から.png", "雛形から.png"] {
            fs::write(vault.attachments_dir().join(name), "x").unwrap();
        }
        // **広く数える。** 数え漏らしはそのまま画像の消失になる
        fs::write(
            vault.trash_dir().join("捨てた.md"),
            "![](attachments/ゴミ箱から.png)\n",
        )
        .unwrap();
        fs::write(
            vault.templates_dir().join("型.md"),
            "![](attachments/雛形から.png)\n",
        )
        .unwrap();

        assert!(vault.unused_attachments().is_empty());
    }

    #[test]
    fn test_trash_attachments_添付以外は動かさない() {
        let (root, vault) = temp_vault();
        let orphan = vault.attachments_dir().join("孤児.png");
        fs::write(&orphan, "x").unwrap();
        let note = blank_note(root.path(), "巻き込まれない.md");

        let moved = vault.trash_attachments(&[orphan.clone(), note.clone()]);

        // **消さない**（ゴミ箱へ移す）。判定は消極的なので戻せる道を残す
        assert_eq!(moved.len(), 1);
        assert!(!orphan.exists());
        assert!(note.is_file()); // ノートは添付ではない
    }

    // ---------------------------------- 元のファイルを写す（TASKS 28-4 / ADR-0070 決定 4）

    #[test]
    fn test_copy_attachment_元のファイルを拡張子ごと写す() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let source = outside.path().join("定例 会議.M4A");
        std::fs::write(&source, b"audio").unwrap();
        let vault = Vault::new(root.path());
        let copied = vault.copy_attachment(&source).unwrap();
        assert_eq!(copied.parent().unwrap(), vault.attachments_dir());
        assert_eq!(copied.extension().unwrap(), "m4a");
        assert_eq!(std::fs::read(&copied).unwrap(), b"audio");
        assert!(source.exists(), "元は残す（写すだけ）");
    }

    #[test]
    fn test_copy_attachment_無いファイルは断り_半端なものを残さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        assert!(vault.copy_attachment(Path::new("/無い/録音.m4a")).is_err());
        let left = std::fs::read_dir(vault.attachments_dir())
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(left, 0);
    }
}
