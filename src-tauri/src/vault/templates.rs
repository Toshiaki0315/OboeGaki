// 雛形（TASKS 3-13 / ADR-0042）。templates/ の下に置き、走査には出さない

use super::*;

/// 雛形の本文（front matter を外したもの）。
///
/// **雛形の front matter は持ち込まない。** ピン留めのような管理情報は
/// 雛形の持ち物で、そこから作るノートの持ち物ではない（参照実装も同じ）。
pub(super) fn template_body(text: &str) -> String {
    match crate::front_matter::block_len(text) {
        Some(len) => text[len..].to_string(),
        None => text.to_string(),
    }
}

impl Vault {
    /// 雛形の本文を埋めて返す（雛形の名前で引く。MCP の `create_note`）。
    /// front matter は持ち込まない（`template_body`）。
    pub fn template_text(
        &self,
        name: &str,
        title: &str,
        now: &DateTime<Local>,
    ) -> io::Result<String> {
        let path = self
            .templates_dir()
            .join(format!("{}.md", sanitize_filename(name)));
        // パスは外から来る。templates の外のファイルを雛形にしない
        if !self.inside_templates(&path) {
            return Err(outside_error("その雛形はありません", &path));
        }
        let text = read_note(&path)?; // Shift_JIS / CRLF の雛形も読む（7-6 と同じ）
        Ok(crate::template::expand(&template_body(&text), now, title).text)
    }

    /// ノートを雛形として登録する。置いた場所を返す。
    ///
    /// **front matter は持ち込まない。** ピン留めのような管理情報は雛形の
    /// 持ち物ではない。見出しは `{{title}}` に差し替える（元の題名のままだと、
    /// この雛形から作るノートが全部その題名になる）。
    ///
    /// 同名の雛形があるときは断る — 黙って上書きすると、手で直した雛形が消える。
    pub fn register_template(&self, path: &Path, name: &str) -> io::Result<PathBuf> {
        if !self.inside(path) {
            return Err(outside_error("保管フォルダの外は登録できない", path));
        }
        let typed = name.trim();
        if typed.is_empty() {
            return Err(invalid("雛形の名前が空"));
        }
        let body = template_body(&read_note(path)?);
        fs::create_dir_all(self.templates_dir())?;
        let target = self
            .templates_dir()
            .join(format!("{}.md", sanitize_filename(typed)));
        if target.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("同じ名前の雛形があります: {typed}"),
            ));
        }
        crate::autosave::save_atomic(&target, &with_title(&body, "{{title}}"))?;
        Ok(target)
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
        let filled = expand(&template_body(&read_note(template)?), now, name);
        let path = self.create_with(name, &filled.text)?;
        Ok(NewNote {
            path,
            cursor: filled.cursor,
        })
    }

    pub(super) fn inside_templates(&self, path: &Path) -> bool {
        match (path.canonicalize(), self.templates_dir().canonicalize()) {
            (Ok(resolved), Ok(dir)) => resolved.starts_with(dir),
            _ => false,
        }
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{at, blank_note, temp_vault};
    use std::fs;

    // ------------------------------------------------------- テンプレート（E-4）
    #[test]
    fn test_templates_雛形を名前順で返し_走査には出さない() {
        let (_root, vault) = temp_vault();
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
        let (_root, vault) = temp_vault();

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
        let (_root, vault) = temp_vault();
        fs::create_dir_all(vault.templates_dir()).unwrap();
        fs::write(vault.templates_dir().join("日次.md"), "# 自分の日次\n").unwrap();

        vault.seed_templates().unwrap();

        let kept = fs::read_to_string(vault.templates_dir().join("日次.md")).unwrap();
        assert_eq!(kept, "# 自分の日次\n");
    }

    #[test]
    fn test_create_from_template_印を埋めてノートを作る() {
        let (root, vault) = temp_vault();
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
        let (root, vault) = temp_vault();
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
        let (_root, vault) = temp_vault();
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
        let (root, vault) = temp_vault();
        let outside = blank_note(root.path(), "普通のノート.md");
        // パスは手で編集できる。外のファイルをノートに変えさせない
        assert!(vault
            .create_from_template(&outside, "x", &at(2026, 9, 3, 14, 5))
            .is_err());
    }

    #[test]
    fn test_register_template_front_matterを持ち込まず見出しを印にする() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "議事の型.md");
        fs::write(&source, "---\npinned: true\n---\n# 議事の型\n\n## 議題\n").unwrap();

        let placed = vault.register_template(&source, "議事録").unwrap();

        assert_eq!(placed, vault.templates_dir().join("議事録.md"));
        // 管理情報は雛形の持ち物ではない。見出しは {{title}} に差し替える
        assert_eq!(
            fs::read_to_string(&placed).unwrap(),
            "# {{title}}\n\n## 議題\n"
        );
    }

    #[test]
    fn test_register_template_同じ名前は断る() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "型.md");
        vault.register_template(&source, "議事録").unwrap();

        // 黙って上書きすると、手で直した雛形が消える
        assert!(vault.register_template(&source, "議事録").is_err());
    }

    // ------------------------------------------------------------ フォルダ（ADR-0024）
    #[test]
    fn test_register_template_Shift_JIS_のノートも雛形にできる() {
        // 雛形の読みだけ `fs::read_to_string` のままで、Shift_JIS / CRLF のノート
        // では失敗し `\r` が混じっていた（他は 7-6 で read_note に統一済み。
        // 棚卸し 2026-09-17）
        let (root, vault) = temp_vault();
        let source = root.path().join("挨拶.md");
        // 「こんにちは」の Shift_JIS + CRLF
        let mut sjis = vec![0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD];
        sjis.extend_from_slice(b"\r\n");
        fs::write(&source, &sjis).unwrap();
        let registered = vault.register_template(&source, "挨拶").unwrap();
        let text = read_note(&registered).unwrap();
        assert!(text.contains("こんにちは"), "{text:?}");
        assert!(!text.contains('\r'));
        let made = vault
            .create_from_template(&registered, "新しい", &Local::now())
            .unwrap();
        assert!(read_note(&made.path).unwrap().contains("こんにちは"));
    }
}
