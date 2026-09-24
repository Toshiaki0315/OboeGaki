// ノートの作成・改名・移動・複製・退避の復元

use super::*;

impl Vault {
    /// 新しいノートを vault 直下に作って、そのパスを返す。
    ///
    /// 本文はタイトルの見出し 1 行（ADR-0005 の「タイトル ↔ 見出し」の対応）。
    /// front matter の id は履歴（ADR-0023）を実装するときに足す。
    #[cfg(test)]
    pub fn create(&self, title: &str) -> io::Result<PathBuf> {
        self.create_in("", title)
    }

    /// フォルダを指定して新しいノートを作る（フォルダの右クリックから）。
    ///
    /// **行き先は実在するフォルダ**（画面の一覧から来る）。空文字は直下。
    /// 予約フォルダや vault の外は `existing_folder_relative` が断る。
    pub fn create_in(&self, folder: &str, title: &str) -> io::Result<PathBuf> {
        self.create_in_with(folder, title, &format!("# {title}\n\n"))
    }

    /// 本文まで決めてフォルダの中に作る（MCP の `create_note` = 10-4）。
    /// 行き先の確かめ方は `create_in` と同じ（同じ道を通す）。
    pub fn create_in_with(&self, folder: &str, title: &str, text: &str) -> io::Result<PathBuf> {
        let cleaned = self.existing_folder_relative(folder)?;
        let destination = if cleaned.is_empty() {
            self.root.clone()
        } else {
            self.root.join(&cleaned)
        };
        fs::create_dir_all(&destination)?;
        // 実体で確かめる。字句検査だけだと、シンボリックリンク経由で
        // vault の外にノートが生まれる（move_note と同じ理由）
        if !self.inside(&destination) {
            return Err(outside_error("保管フォルダの外には作れない", &destination));
        }
        let stem = sanitize_filename(title);
        let path = unique_path(&destination, &stem, ".md", None);
        crate::autosave::save_atomic(&path, text)?;
        Ok(path)
    }

    /// 本文を指定して新しいノートを作る（雛形から作るとき）。
    pub(super) fn create_with(&self, title: &str, text: &str) -> io::Result<PathBuf> {
        let stem = sanitize_filename(title);
        let path = unique_path(&self.root, &stem, ".md", None);
        crate::autosave::save_atomic(&path, text)?;
        Ok(path)
    }

    /// ノートを複製する。作った先を返す。
    ///
    /// **元と同じフォルダに作る。** 分類して置いたノートの複製が vault 直下に
    /// 出ると、片方だけ箱から外れる。**見出しも新しい名前に揃える** — 題名は
    /// 本文の見出し（ADR-0005）なので、写しただけだと一覧に同じ名前が
    /// 2 つ並んで見分けが付かない。
    pub fn duplicate(&self, path: &Path) -> io::Result<PathBuf> {
        if !self.inside(path) {
            return Err(outside_error("保管フォルダの外は複製できない", path));
        }
        let text = read_note(path)?;
        let folder = path.parent().unwrap_or(&self.root).to_path_buf();
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(UNTITLED);
        // **先に sanitize してから空きを探す**（参照実装のコードレビュー指摘）。
        // 生の名前から探すと `-2-2` の二重接尾や見出しとの食い違いが起きる
        let target = unique_path(&folder, &sanitize_filename(stem), ".md", None);
        let title = target
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(UNTITLED);
        crate::autosave::save_atomic(&target, &with_title(&text, title))?;
        Ok(target)
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
        // 行き先は**実在すればその名前のまま**使う。無ければ新規作成なので
        // サニタイズした名前で作る
        let raw = self.existing_folder_relative(folder)?;
        let cleaned = if raw.is_empty() || self.root.join(&raw).is_dir() {
            raw
        } else {
            self.folder_relative(folder)?
        };
        let destination = if cleaned.is_empty() {
            self.root.clone()
        } else {
            self.root.join(&cleaned)
        };
        if path.parent() == Some(destination.as_path()) {
            return Ok(path.to_path_buf()); // 同じ場所。動かす意味が無い
        }
        fs::create_dir_all(&destination)?;
        // 行き先も**実体**で封じ込めを確かめる。字句検査だけだと、
        // シンボリックリンク経由で vault の外へノートが出る
        //（レビュー 2026-09-04）
        if !self.inside(&destination) {
            return Err(outside_error("保管フォルダの外へは移せない", &destination));
        }
        let (stem, suffix) = split_name(path, ".md");
        let target = unique_path(&destination, &stem, &suffix, None);
        fs::rename(path, &target)?;
        self.carry_history(path, &target);
        Ok(target)
    }

    /// 退避（クラッシュリカバリ）を**別ファイルとして**書き出す。
    ///
    /// **元のファイルを上書きしない。** 復元は「見つかった内容を失わない」
    /// ためのもので、ディスク上の内容を捨ててよいとは限らない。
    /// **元のフォルダに戻す**（箱が消えていたら直下へ。無い箱は作らない）。
    pub fn restore_stash(&self, source: &Path, text: &str, stamp: &str) -> io::Result<PathBuf> {
        // 箱ごと消えていることがある（`contains` は実在する祖先で確かめるので
        // 通らない）。その場合は文字の上で vault の下にあることを見る
        let inside = contains(&self.root, source)
            || (source.starts_with(&self.root)
                && !source
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir)));
        if !inside {
            return Err(outside_error("保管フォルダの外は復元できない", source));
        }
        let folder = match source.parent() {
            Some(parent) if parent.is_dir() => parent.to_path_buf(),
            _ => self.root.clone(),
        };
        let stem = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(UNTITLED);
        let name = sanitize_filename(&format!("{stem} (復元 {stamp})"));
        let target = unique_path(&folder, &name, ".md", None);
        crate::autosave::save_atomic(&target, text)?;
        Ok(target)
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
        // 拡張子は元のまま（`.markdown` を `.md` に変えない。監査 2026-09-17）
        let (_, suffix) = split_name(path, ".md");
        if folder.join(format!("{stem}{suffix}")) == *path {
            return Ok(path.to_path_buf()); // 同じ名前。動かす意味が無い
        }
        let target = unique_path(&folder, &stem, &suffix, Some(path));
        // 「名前を変更」は本文の見出しも書き換える（ADR-0005）。見出しには打った
        // 通りのタイトルが入る（ファイル名側だけ sanitize）。
        // **版を残すのは動かす前・旧鍵で。** 動かした後に残せず失敗すると、
        // ファイルだけ新しい名前へ移った半端な状態が残り、呼び手は旧パスのまま
        // 次の自動保存を書いてノートが二重になる（レビュー 2026-09-25 / 21-5）。
        // 残した版は carry_history が新しい鍵へ連れて行く
        let text = read_note(path)?;
        let rewritten = with_title(&text, title);
        if rewritten != text {
            self.keep_version(path, &text).map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("版を残せなかったので改名を止めました: {error}"),
                )
            })?;
        }
        fs::rename(path, &target)?;
        // 版も連れて行く（鍵はファイルに付いて回る = ADR-0042）
        self.carry_history(path, &target);
        if rewritten != text {
            crate::autosave::save_atomic(&target, &rewritten)?;
        }
        Ok(target)
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
    fn test_create_in_フォルダの中に作る() {
        // フォルダを右クリックして新規ノート（要望 2026-09-05）
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        fs::create_dir(root.path().join("仕事")).unwrap();
        let path = vault.create_in("仕事", "無題").unwrap();
        assert_eq!(path, root.path().join("仕事/無題.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# 無題\n\n");
    }

    #[test]
    fn test_create_in_空文字は保管フォルダの直下() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        assert_eq!(
            vault.create_in("", "無題").unwrap(),
            root.path().join("無題.md")
        );
    }

    #[test]
    fn test_create_in_予約フォルダと外には作らせない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        assert!(vault.create_in(".trash", "無題").is_err());
        assert!(vault.create_in("../外", "無題").is_err());
    }

    #[test]
    fn test_rename_元のフォルダに留めて改名し見出しも追従する() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let old = blank_note(root.path(), "sub/旧名.md");
        let renamed = vault.rename(&old, "新名").unwrap();
        assert_eq!(renamed, root.path().join("sub/新名.md"));
        assert!(!old.exists());
        // ADR-0005: 「名前を変更」は本文の見出しも書き換える
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "# 新名\n");
    }

    #[test]
    fn test_rename_同じ名前なら何もしない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = blank_note(root.path(), "同じ.md");
        assert_eq!(vault.rename(&path, "同じ").unwrap(), path);
        assert!(path.exists());
    }

    #[test]
    fn test_rename_衝突したら連番を付ける() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        blank_note(root.path(), "先客.md");
        let old = blank_note(root.path(), "旧名.md");
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
        let escape = blank_note(outside.path(), "外.md");
        let vault = Vault::new(root.path());
        assert!(vault.rename(&escape, "新名").is_err());
        assert!(escape.exists());
    }

    // ------------------------------------------------------------ 複製と登録
    #[test]
    fn test_duplicate_元と同じフォルダに作り見出しも揃える() {
        let (root, vault) = temp_vault();
        let source = root.path().join("仕事/会議.md");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "# 会議\n\n本文。\n").unwrap();

        let copy = vault.duplicate(&source).unwrap();

        // 分類して置いたノートの複製が直下に出ると、片方だけ箱から外れる
        assert_eq!(copy, root.path().join("仕事/会議-2.md"));
        // **見出しも新しい名前に揃える**（一覧に同じ名前が 2 つ並ばない）
        assert_eq!(fs::read_to_string(&copy).unwrap(), "# 会議-2\n\n本文。\n");
    }

    #[test]
    fn test_duplicate_vaultの外は断る() {
        let (_root, vault) = temp_vault();
        let outside = TempDir::new().unwrap();
        let path = outside.path().join("外.md");
        fs::write(&path, "# 外\n").unwrap();

        assert!(vault.duplicate(&path).is_err());
    }

    // ------------------------------------------------------------ 退避の復元
    #[test]
    fn test_restore_stash_別ファイルとして元のフォルダに置く() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "仕事/会議.md");

        let restored = vault
            .restore_stash(&source, "# 会議\n\n書きかけ\n", "2026-09-03")
            .unwrap();

        assert_eq!(restored, root.path().join("仕事/会議 (復元 2026-09-03).md"));
        assert_eq!(
            fs::read_to_string(&restored).unwrap(),
            "# 会議\n\n書きかけ\n"
        );
        // **元のファイルを上書きしない。** 復元は「見つかった内容を失わない」
        // ためのもので、ディスク上の内容を捨ててよいとは限らない
        assert_eq!(fs::read_to_string(&source).unwrap(), "# note\n");
    }

    #[test]
    fn test_restore_stash_箱が消えていたら直下へ() {
        let (root, vault) = temp_vault();
        // 無い箱は作らない（spec §7.1）
        let gone = root.path().join("消えた/会議.md");

        let restored = vault
            .restore_stash(&gone, "書きかけ", "2026-09-03")
            .unwrap();

        assert_eq!(restored, root.path().join("会議 (復元 2026-09-03).md"));
    }

    #[test]
    fn test_restore_stash_同じ名前があれば連番() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "会議.md");

        let first = vault
            .restore_stash(&source, "1 回目", "2026-09-03")
            .unwrap();
        let second = vault
            .restore_stash(&source, "2 回目", "2026-09-03")
            .unwrap();

        assert_ne!(second, first);
        assert_eq!(fs::read_to_string(&first).unwrap(), "1 回目");
    }

    #[test]
    fn test_restore_stash_vaultの外は断る() {
        let (_root, vault) = temp_vault();
        let outside = TempDir::new().unwrap().path().join("外.md");

        assert!(vault.restore_stash(&outside, "本文", "2026-09-03").is_err());
    }

    #[test]
    fn test_rename_拡張子を保ち_版も連れて行く() {
        // `.md` 決め打ちで `.markdown` のノートを改名すると拡張子が変わり、同名の
        // 判定も外れていた。版の付け替えは commands 側にあった（監査 2026-09-17）
        let (root, vault) = temp_vault();
        let path = root.path().join("a.markdown");
        fs::write(&path, "# a\n").unwrap();
        let store = crate::history::store_root(&vault.managed_dir());
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:a.markdown", "古い", at, true, 0).unwrap();
        // 同じ名前なら動かさない（拡張子が違っても）
        assert_eq!(vault.rename(&path, "a").unwrap(), path);
        let renamed = vault.rename(&path, "b").unwrap();
        assert_eq!(renamed, root.path().join("b.markdown"));
        // 連れて行った 1 版 + 見出しを書き換える前の姿（21-1）で 2 版
        let carried = crate::history::versions(&store, "path:b.markdown");
        assert_eq!(carried.len(), 2);
        assert!(crate::history::versions(&store, "path:a.markdown").is_empty());
    }

    #[test]
    fn test_move_note_履歴も連れて行く() {
        use chrono::NaiveDate;
        let (root, vault) = temp_vault();
        let path = blank_note(root.path(), "設計.md");
        let store = crate::history::store_root(&vault.managed_dir());
        let at = NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:設計.md", "前の本文", at, true, 0).unwrap();

        let moved = vault.move_note(&path, "仕事").unwrap();
        assert_eq!(moved, root.path().join("仕事/設計.md"));
        assert_eq!(
            crate::history::versions(&store, "path:仕事/設計.md").len(),
            1
        );
    }

    #[test]
    fn test_move_note_フォルダへ移し_無ければ作る() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "会議.md");

        let moved = vault.move_note(&source, "仕事/2026").unwrap();

        assert_eq!(moved, root.path().join("仕事/2026/会議.md"));
        assert!(!source.exists());
        // 本文は書き換えない（T1）
        assert_eq!(fs::read_to_string(&moved).unwrap(), "# note\n");
    }

    #[test]
    fn test_move_note_直下へ戻す_同じ場所なら何もしない() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "仕事/会議.md");

        let moved = vault.move_note(&source, "").unwrap();
        assert_eq!(moved, root.path().join("会議.md"));
        // 空になっても元のフォルダは残す（ADR-0024 追記 2）
        assert!(root.path().join("仕事").is_dir());

        assert_eq!(vault.move_note(&moved, "").unwrap(), moved);
    }

    #[test]
    fn test_move_note_同名があれば連番_予約フォルダは断る() {
        let (root, vault) = temp_vault();
        let source = blank_note(root.path(), "仕事/会議.md");
        blank_note(root.path(), "会議.md");

        assert_eq!(
            vault.move_note(&source, "").unwrap(),
            root.path().join("会議-2.md")
        );
        assert!(vault
            .move_note(&root.path().join("会議-2.md"), "attachments")
            .is_err());
    }

    /// 改名の見出し書き換えも版を残してから。残せなければ見出しは触らない（21-1）
    #[test]
    fn test_rename_版を残せなければ見出しを書き換えない() {
        let (root, vault) = crate::test_support::temp_vault();
        let note = crate::test_support::note(root.path(), "a.md", "# 旧\n\n本文\n");
        let _locked = crate::test_support::lock_history(&vault);
        assert!(vault.rename(&note, "新").is_err());
        // 何も動いていない（動かした後に失敗すると旧パスと新パスの 2 つになる。21-5）
        assert!(!root.path().join("新.md").exists());
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "# 旧\n\n本文\n");
    }
}
