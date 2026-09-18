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
        let Ok(entries) = fs::read_dir(self.attachments_dir()) else {
            return Vec::new();
        };
        let mut used: HashSet<String> = HashSet::new();
        for note in self.all_markdown() {
            if let Ok(text) = read_note(&note) {
                used.extend(crate::references::attachment_names(&text));
            }
        }
        let mut found: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    return false;
                };
                path.is_file() && !name.starts_with('.') && !used.contains(name)
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
}
