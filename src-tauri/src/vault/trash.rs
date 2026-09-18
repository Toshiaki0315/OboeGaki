// ゴミ箱（ADR-0023）: 階層を保って移し、期限で消し、戻す。版（履歴）も連れて行く

use super::*;

/// 空になったフォルダを `boundary` の手前まで遡って消す。
///
/// ゴミ箱の中だけで使う。ユーザーに見えるフォルダは空でも残す
/// （ADR-0024）。完全に空のときだけ消す。
pub(super) fn prune_empty_dirs(start: &Path, boundary: &Path) {
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

/// 捨てた時刻。**mtime をそのまま読む。**
///
/// rename は mtime を保つので `trash()` が捨てるときに今へ刻み直している
/// （`test_trash_捨てた直後のmtimeは今になる`）。期限切れの掃除
/// （`purge_trash`）も同じ mtime で測るため、ここで見せる時刻と
/// 「いつ消えるか」がずれない。
pub(super) fn trashed_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// 捨てた新しい順。同じ時刻ならパス順（並びが日によって入れ替わらない）。
pub(super) fn sort_by_trashed(entries: &mut [TrashEntry]) {
    entries.sort_by(|a, b| {
        b.trashed_ms
            .cmp(&a.trashed_ms)
            .then_with(|| a.path.cmp(&b.path))
    });
}

impl Vault {
    /// ゴミ箱へ移す（ノート用）。**捨てるときの約束はここが唯一の持ち主** —
    /// 画面からも MCP からも同じ道を通す（レビュー 2026-09-13。同じ規則が
    /// commands/ と mcp/ に二重に書いてあった）。
    ///
    /// - ピン留め中は断る（spec §7.3 の削除ガード）。消してよいなら先に
    ///   ピンを外す、という一拍を挟む
    /// - 履歴の鍵は**ファイルに付いて回る**（ADR-0042）。付け替えないと、
    ///   戻すときに履歴が行方不明になる
    ///
    /// 添付は `trash_attachments`（ピンも履歴も無い）。索引の更新と監視の
    /// 抑制は呼ぶ側の持ち物 — MCP は索引を触らない
    pub fn trash_note(&self, path: &Path) -> io::Result<PathBuf> {
        if read_note(path)
            .map(|text| crate::front_matter::pinned(&text))
            .unwrap_or(false)
        {
            return Err(invalid(
                "ピン留め中のノートはゴミ箱へ移せない（先にピンを外す）",
            ));
        }
        // 版は trash が連れて行く
        self.trash(path)
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
            let (stem, suffix) = split_name(&target, "");
            let parent = target.parent().map(Path::to_path_buf).unwrap_or_default();
            // タイムスタンプでも衝突したら（同一秒に 2 回捨てた）連番で逃がす
            unique_path(&parent, &format!("{stem}-{stamp}"), &suffix, None)
        } else {
            target
        };
        fs::rename(path, &target)?;
        // 版も連れて行く（鍵はファイルに付いて回る = ADR-0042。restore と対称）
        self.carry_history(path, &target);
        // purge_trash の期限は「捨ててから」数える。rename は mtime を
        // 変えないので、ここで刻み直さないと古いノートが即座に消える。
        // 失敗は黙らせない（読み取り専用・同期フォルダ等で普通に起きる）—
        // その場合も purge_trash が ctime を併用して守る
        match fs::File::options().write(true).open(&target) {
            Ok(file) => {
                if let Err(error) =
                    file.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now()))
                {
                    eprintln!("ゴミ箱の時刻を刻み直せなかった: {error}");
                }
            }
            Err(error) => eprintln!("ゴミ箱の時刻を刻み直せなかった: {error}"),
        }
        Ok(target)
    }

    /// 期限を過ぎたゴミ箱の中身を消す（spec §7.6）。vault を開いたときに呼ぶ。
    ///
    /// 1 件の不調で掃除ごと投げ出さない — 同期の下では走査と stat の間に
    /// ファイルが消える（iCloud / Dropbox / 別マシンが同じ vault を触る）。
    pub fn purge_trash(&self, days: u64) -> io::Result<Vec<PathBuf>> {
        self.purge_trash_at(days, std::time::SystemTime::now())
    }

    /// `purge_trash` の時刻注入版（テスト用に分離。history と同じ作法）。
    fn purge_trash_at(&self, days: u64, now: std::time::SystemTime) -> io::Result<Vec<PathBuf>> {
        let trash = self.trash_dir();
        if !trash.is_dir() {
            return Ok(vec![]);
        }
        // 最短でも 1 日は置く。画面は 1〜365 に丸めるが、ここに守りが無いと
        // `trash_days: 0` で開いた瞬間にゴミ箱が空になる（監査 2026-09-17）
        let days = days.max(1);
        // days が極端でも引き算でパニックしない（checked_sub。レビュー指摘 #17）
        let Some(deadline) = now.checked_sub(std::time::Duration::from_secs(
            days.saturating_mul(24 * 3600),
        )) else {
            return Ok(vec![]); // 期限が時間の始まりより前 = 何も期限切れでない
        };
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
                // mtime と ctime の**新しいほう**で数える。rename は
                // mtime を保つが ctime は必ず更新するので、trash() の
                // 刻み直しが失敗していても「捨ててから 30 日」が守られる
                //（レビュー 2026-09-04）
                let expired = fs::metadata(&path)
                    .map(|m| {
                        use std::os::unix::fs::MetadataExt;
                        let changed = std::time::UNIX_EPOCH
                            + std::time::Duration::from_secs(m.ctime().max(0) as u64);
                        let newest = m.modified().map_or(changed, |mo| mo.max(changed));
                        newest < deadline
                    })
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

    /// ゴミ箱の中身を**捨てた新しい順**で返す（一覧の見やすさ）。
    ///
    /// 直前に捨てたものを戻すことが多いので、それを上に置く。
    pub fn trash_entries(&self) -> Vec<TrashEntry> {
        let mut entries: Vec<TrashEntry> = self
            .trash_list()
            .into_iter()
            .map(|path| TrashEntry {
                trashed_ms: trashed_ms(&path),
                path,
            })
            .collect();
        sort_by_trashed(&mut entries);
        entries
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
        let (stem, suffix) = split_name(&resolved, "");
        let target = unique_path(&destination, &stem, &suffix, None);
        fs::rename(&resolved, &target)?;
        // 版も連れて戻る（trash と対称。戻した先の名前が変わっても鍵は付いて回る）
        self.carry_history(&resolved, &target);
        if let Some(parent) = resolved.parent() {
            prune_empty_dirs(parent, &trash);
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

    /// テスト用: ファイルの mtime を任意の時刻にする。
    fn set_mtime(path: &Path, at: std::time::SystemTime) {
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(at))
            .unwrap();
    }

    /// テスト用: ファイルの mtime を「日数」だけ過去にずらす。
    fn age_file(path: &Path, days: u64) {
        set_mtime(
            path,
            std::time::SystemTime::now() - std::time::Duration::from_secs(days * 24 * 3600),
        );
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
        let path = blank_note(root.path(), "古い.md");
        age_file(&path, 90);

        let target = vault.trash(&path).unwrap();
        let elapsed = mtime(&target).elapsed().unwrap();
        assert!(elapsed < std::time::Duration::from_secs(60));
    }

    #[test]
    fn test_purge_trash_mtimeを刻めなくても捨てた直後のものは消さない() {
        // レビュー 2026-09-04: rename は mtime を保ち、刻み直しの失敗は
        // 無音だった。古いノートを捨てた直後に vault を開くと 30 日の
        // 猶予なしで恒久削除されていた。unix の ctime（rename で必ず
        // 更新される）も見ることで、刻み直せなくても守られることを固定する
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = blank_note(root.path(), "古い.md");
        age_file(&path, 90);

        let target = vault.trash(&path).unwrap();
        // mtime の刻み直しが失敗した状況を再現する（過去へ戻す）
        age_file(&target, 90);

        let removed = vault.purge_trash(30).unwrap();
        assert_eq!(removed, Vec::<PathBuf>::new());
        assert!(target.exists(), "捨てた直後のものは期限内");
    }

    #[test]
    fn test_purge_trash_保持日数が0でも捨てた直後のものは消さない() {
        // 画面は 1〜365 に丸めるが Rust 側に守りが無く、`trash_days: 0` で開くと
        // ゴミ箱が即刻空になった（監査 2026-09-17）。最短でも 1 日は置く
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let path = blank_note(root.path(), "直前.md");
        let target = vault.trash(&path).unwrap();
        let removed = vault
            .purge_trash_at(0, std::time::SystemTime::now())
            .unwrap();
        assert_eq!(removed, Vec::<PathBuf>::new());
        assert!(target.exists());
    }

    #[test]
    fn test_purge_trash_期限を過ぎたものだけ消して空の殻も残さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let old = blank_note(root.path(), &format!("{TRASH_DIR}/sub/古い.md"));
        let fresh = blank_note(root.path(), &format!("{TRASH_DIR}/新しい.md"));
        age_file(&old, 31);

        // ctime（作られた今）も見るようになったので、時計を進めて判定し、
        // 「新しい」はその時計から見て新しい mtime を持たせる
        let future = std::time::SystemTime::now() + std::time::Duration::from_secs(40 * 24 * 3600);
        set_mtime(&fresh, future);
        let removed = vault.purge_trash_at(30, future).unwrap();
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
        let a = blank_note(root.path(), &format!("{TRASH_DIR}/a.md"));
        let b = blank_note(root.path(), &format!("{TRASH_DIR}/sub/b.md"));
        let keep = blank_note(root.path(), "残る.md");

        vault.empty_trash().unwrap();
        assert!(!a.exists());
        assert!(!b.exists());
        assert!(keep.exists(), "ゴミ箱の外は触らない");
    }

    #[test]
    fn test_delete_permanently_ゴミ箱の1件だけ消して殻を残さない() {
        let root = TempDir::new().unwrap();
        let vault = Vault::new(root.path());
        let gone = blank_note(root.path(), &format!("{TRASH_DIR}/sub/消す.md"));
        let keep = blank_note(root.path(), &format!("{TRASH_DIR}/残す.md"));

        vault.delete_permanently(&gone).unwrap();
        assert!(!gone.exists());
        assert!(!gone.parent().unwrap().exists());
        assert!(keep.exists());
    }

    #[test]
    fn test_delete_permanently_ゴミ箱の外は消さずにエラー() {
        // 押し間違いが取り返しのつかない結果にならないための境界
        let (root, vault) = temp_vault();
        let alive = blank_note(root.path(), "生きている.md");
        assert!(vault.delete_permanently(&alive).is_err());
        assert!(alive.exists());
        let sneaky = root.path().join(format!("{TRASH_DIR}/../生きている.md"));
        assert!(vault.delete_permanently(&sneaky).is_err());
        assert!(alive.exists());
    }

    #[test]
    fn test_delete_permanently_既に無ければ何もしない() {
        let (_root, vault) = temp_vault();
        let gone = vault.trash_dir().join("無い.md");
        assert!(vault.delete_permanently(&gone).is_ok());
    }

    #[test]
    fn test_trash_階層を保ってゴミ箱へ移す() {
        let (root, vault) = temp_vault();
        let path = blank_note(root.path(), "sub/捨てる.md");
        let moved = vault.trash(&path).unwrap();
        assert_eq!(moved, vault.trash_dir().join("sub/捨てる.md"));
        assert!(!path.exists());
        assert!(moved.exists());
    }

    #[test]
    fn test_trash_同名があればタイムスタンプを付ける() {
        let (root, vault) = temp_vault();
        let first = blank_note(root.path(), "同名.md");
        vault.trash(&first).unwrap();
        let second = blank_note(root.path(), "同名.md");
        let moved = vault.trash(&second).unwrap();
        assert_ne!(moved, vault.trash_dir().join("同名.md"));
        let name = moved.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("同名-") && name.ends_with(".md"));
    }

    #[test]
    fn test_trash_既にゴミ箱の中なら動かさない() {
        let (root, vault) = temp_vault();
        let path = blank_note(root.path(), "x.md");
        let moved = vault.trash(&path).unwrap();
        assert_eq!(vault.trash(&moved).unwrap(), moved);
        assert!(moved.exists());
    }

    #[test]
    fn test_trash_vault外は拒否する() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = blank_note(outside.path(), "外.md");
        let vault = Vault::new(root.path());
        vault.ensure_layout().unwrap();
        assert!(vault.trash(&escape).is_err());
        assert!(escape.exists());
    }

    #[test]
    fn test_trash_list_ゴミ箱の中の階層ごとノートを名前順で返す() {
        let (root, vault) = temp_vault();
        let a = vault.trash(&blank_note(root.path(), "a.md")).unwrap();
        let inner = vault
            .trash(&blank_note(root.path(), "sub/inner.md"))
            .unwrap();
        blank_note(root.path(), "生きている.md"); // ゴミ箱の外は入らない

        assert_eq!(vault.trash_list(), vec![a, inner]);
    }

    #[test]
    fn test_trash_entries_捨てた時刻を読む() {
        let (root, vault) = temp_vault();
        let moved = vault.trash(&blank_note(root.path(), "a.md")).unwrap();

        let entries = vault.trash_entries();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, moved);
        // 捨てた時刻が読めている（0 のままなら metadata を見ていない）
        assert!(entries[0].trashed_ms > 0);
    }

    #[test]
    fn test_捨てた新しい順に並ぶ_同じ時刻ならパス順() {
        // **中身の更新時刻ではなく、捨てた順。** 直前に捨てたものを戻す
        // ことが多いので、それが上に来る
        let entry = |path: &str, ms: i64| TrashEntry {
            path: PathBuf::from(path),
            trashed_ms: ms,
        };
        let mut entries = vec![
            entry("古い.md", 100),
            entry("b.md", 300),
            entry("新しい.md", 500),
            entry("a.md", 300),
        ];

        sort_by_trashed(&mut entries);

        let order: Vec<_> = entries.iter().map(|e| e.path.clone()).collect();
        assert_eq!(
            order,
            vec![
                PathBuf::from("新しい.md"),
                PathBuf::from("a.md"),
                PathBuf::from("b.md"),
                PathBuf::from("古い.md"),
            ]
        );
    }

    #[test]
    fn test_trash_list_ゴミ箱が無ければ空() {
        let root = TempDir::new().unwrap();
        assert_eq!(Vault::new(root.path()).trash_list(), Vec::<PathBuf>::new());
    }

    #[test]
    fn test_restore_元のフォルダへ戻しフォルダが消えていれば作り直す() {
        let (root, vault) = temp_vault();
        let moved = vault.trash(&blank_note(root.path(), "sub/a.md")).unwrap();
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
        let (root, vault) = temp_vault();
        let moved = vault.trash(&blank_note(root.path(), "a.md")).unwrap();
        blank_note(root.path(), "a.md"); // 同名の後継が生まれている

        let restored = vault.restore(&moved).unwrap();
        assert_eq!(restored, root.path().join("a-2.md"));
    }

    #[test]
    fn test_restore_ゴミ箱の外は拒否する() {
        let (root, vault) = temp_vault();
        let alive = blank_note(root.path(), "生きている.md");
        assert!(vault.restore(&alive).is_err());
        assert!(alive.exists());
    }

    #[test]
    fn test_restore_ゴミ箱から戻すと版も連れて戻る() {
        // trash は版を連れて行く（carry_history）のに、restore は連れて戻らず
        // commands 側が別の鍵で付け替えていた（非対称。監査 2026-09-17）
        let (root, vault) = temp_vault();
        let path = blank_note(root.path(), "a.md");
        let store = crate::history::store_root(&vault.managed_dir());
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:a.md", "古い", at, true, 0).unwrap();
        let trashed = vault.trash(&path).unwrap();
        assert!(crate::history::versions(&store, "path:a.md").is_empty());
        let back = vault.restore(&trashed).unwrap();
        assert_eq!(back, root.path().join("a.md"));
        assert_eq!(crate::history::versions(&store, "path:a.md").len(), 1);
        assert!(crate::history::versions(&store, "path:.trash/a.md").is_empty());
    }

    #[test]
    fn test_trash_note_ピン留めは断り_履歴を連れて行く() {
        use chrono::NaiveDate;
        let (root, vault) = temp_vault();
        let ordinary = root.path().join("要らない.md");
        fs::write(&ordinary, "# 要らない\n").unwrap();
        let pinned = root.path().join("大事.md");
        fs::write(&pinned, "---\npinned: true\n---\n# 大事\n").unwrap();
        let store = crate::history::store_root(&vault.managed_dir());
        let at = NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        crate::history::keep(&store, "path:要らない.md", "前の本文", at, true, 0).unwrap();

        // ピン留め中は断る（spec §7.3。先にピンを外す一拍を挟む）
        assert!(vault.trash_note(&pinned).is_err());
        assert!(pinned.is_file());

        let moved = vault.trash_note(&ordinary).unwrap();
        assert_eq!(moved, vault.trash_dir().join("要らない.md"));
        assert!(!ordinary.exists());
        // 鍵はファイルに付いて回る（ADR-0042）
        assert_eq!(
            crate::history::versions(&store, "path:.trash/要らない.md").len(),
            1
        );
    }
}
