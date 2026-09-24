// 日次ノート（ADR-0056 / 0057）: 今日のノートを引き当てて末尾に足す

use super::*;

impl Vault {
    /// 今日のノートを開く。無ければ雛形から作る。
    ///
    /// **同じ日に何度呼んでも同じノートを返す。** 2 つできると、どちらに
    /// 書いたか分からなくなる。`.md` は vault 直下に置く（日付でフォルダを
    /// 切らないのは spec §7.1 — 分類はタグで行う）。
    /// 今日のノートが**置かれる場所**。作りはしない（作る前に「そこへ書いて
    /// よいか」を確かめたい呼び手のため）
    pub fn daily_path(&self, now: &DateTime<Local>) -> PathBuf {
        self.root
            .join(format!("{}.md", sanitize_filename(&daily_title(now))))
    }

    pub fn daily_note(&self, now: &DateTime<Local>) -> io::Result<NewNote> {
        let title = daily_title(now);
        let path = self.daily_path(now);
        if path.is_file() {
            // 既にあるものへ印を埋め直さない。書いた内容が唯一の真実（T1）
            return Ok(NewNote { path, cursor: None });
        }
        let source = self.templates_dir().join(DAILY_TEMPLATE);
        let body = read_note(&source)
            .map(|text| template_body(&text))
            .unwrap_or_else(|_| format!("# {title}\n\n"));
        let filled = expand(&body, now, &title);
        let path = self.create_with(&title, &filled.text)?;
        Ok(NewNote {
            path,
            cursor: filled.cursor,
        })
    }

    /// 今日のノートの末尾に追記する（どこからでも書き取り = ADR-0057）。
    /// 無ければ作る。前の行に繋げない（末尾に改行が無ければ挟む）。空白だけ
    /// なら書かない。監視の抑制はしない — 主窓が同じノートを開いていれば
    /// 外部変更として読み直させる
    pub fn append_to_daily(&self, now: &DateTime<Local>, text: &str) -> io::Result<PathBuf> {
        if text.trim().is_empty() {
            return Err(invalid("書くものが空"));
        }
        let path = self.daily_note(now)?.path;
        let before = read_note(&path)?;
        let mut current = before.clone();
        if !current.is_empty() && !current.ends_with('\n') {
            current.push('\n');
        }
        current.push_str(text.trim_end_matches('\n'));
        current.push('\n');
        // 追記も「読んで書き戻す」。版を残せなければ足さない（21-1）
        self.write_with_version(&path, &before, &current)?;
        Ok(path)
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{at, temp_vault};
    use std::fs;

    // どこからでも書き取り（ADR-0057 / 12-6）: 今日のノートの末尾に追記
    #[test]
    fn test_append_to_daily_無ければ作り_末尾に改行を挟んで足す() {
        let (root, vault) = temp_vault();
        let now = at(2026, 9, 11, 9, 0);

        let path = vault.append_to_daily(&now, "思いつき").unwrap();
        assert_eq!(path, root.path().join("2026-09-11.md"));
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# 2026-09-11\n"));
        assert!(text.ends_with("\n思いつき\n"), "{text:?}");

        // 末尾に改行が無いファイルでも、前の行に繋げない
        fs::write(&path, "# 2026-09-11\n\n前の行").unwrap();
        vault.append_to_daily(&now, "次の行\n").unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# 2026-09-11\n\n前の行\n次の行\n"
        );
        // 空白だけは書かない
        assert!(vault.append_to_daily(&now, "  \n").is_err());
    }

    #[test]
    fn test_daily_note_同じ日に何度呼んでも同じノート() {
        let (root, vault) = temp_vault();
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
        let (_root, vault) = temp_vault();

        let made = vault.daily_note(&at(2026, 9, 3, 14, 5)).unwrap();

        assert_eq!(fs::read_to_string(&made.path).unwrap(), "# 2026-09-03\n\n");
    }

    /// 追記も「読んで書き戻す」なので版を残す。残せなければ足さない（21-1）
    #[test]
    fn test_append_to_daily_版を残せなければ足さない() {
        let (root, vault) = temp_vault();
        let now = at(2026, 9, 24, 9, 0);
        let path = vault.daily_note(&now).unwrap().path;
        let before = fs::read_to_string(&path).unwrap();
        let _locked = crate::test_support::lock_history(&vault);
        assert!(vault.append_to_daily(&now, "追記").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        let _ = root;
    }
}
