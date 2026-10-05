// 施錠ノート（`.md.enc`）を保管フォルダの中で読み書きする（TASKS 13-3 / ADR-0062）。
// 暗号そのものは crate::lock。ここは「どのファイルで確かめるか」と、読み書きの道。
//
// **平文はファイルに書かない。** 書くのは暗号文だけで、版（履歴）も退避も残さない
// （ADR-0062 決定 4）。鍵は呼び手（commands の状態）が持ち、ここは借りるだけ。

use std::fs;
use std::path::Path;

use crate::lock::{self, Key, LockError};

use super::Vault;

/// 施錠ノートを開いて本文にする
pub fn read_locked(path: &Path, key: &Key) -> Result<String, LockError> {
    let bytes = fs::read(path).map_err(|error| LockError::System(error.to_string()))?;
    lock::open(key, &bytes)
}

/// 本文を施錠して書く（一時ファイル経由で入れ替える。途中で落ちても前の暗号文が残る）
pub fn write_locked(path: &Path, key: &Key, text: &str) -> Result<(), LockError> {
    let sealed = lock::seal(key, text)?;
    crate::autosave::save_bytes_atomic(path, &sealed)
        .map_err(|error| LockError::System(error.to_string()))
}

/// パスワードで解錠する。**既にある施錠ノートを 1 つ開けてみて**確かめ（認証タグ）、
/// 合えばその salt の鍵を返す（保管フォルダに 1 つのパスワード。ADR-0062 決定 1）
pub fn unlock(vault: &Vault, password: &str) -> Result<Key, LockError> {
    let Some(sample) = vault.scan_locked().into_iter().next() else {
        return Err(LockError::NoLockedNotes);
    };
    let bytes = fs::read(&sample).map_err(|error| LockError::System(error.to_string()))?;
    let key = Key::for_file(password, &bytes)?;
    lock::open(&key, &bytes)?;
    Ok(key)
}

// ------------------------------------------- 施錠する・外す・鍵の変更（13-5）

/// 施錠を外したもの・施錠したものの名前（同じフォルダ・同じ題。重なれば枝番）
fn sibling(path: &Path, suffix: &str) -> std::path::PathBuf {
    let folder = path.parent().unwrap_or(Path::new("."));
    super::unique_path(folder, &super::note_stem(path), suffix, None)
}

fn system(error: std::io::Error) -> LockError {
    LockError::System(error.to_string())
}

/// `.md` を施錠して `.md.enc` にする。**新しい方を書き切って開けることを確かめてから**
/// 元を消す（途中で落ちても失わない）。元の平文の版も消す（残すとそこから読める。
/// ADR-0062 決定 4）。施錠したノートの場所を返す
pub fn lock_note(vault: &Vault, path: &Path, key: &Key) -> Result<std::path::PathBuf, LockError> {
    if !super::is_markdown(path) {
        return Err(LockError::System(
            "施錠できるのは .md のノートだけです".into(),
        ));
    }
    let text = super::read_note(path).map_err(system)?;
    let target = sibling(path, super::LOCKED_SUFFIX);
    write_locked(&target, key, &text)?;
    if read_locked(&target, key)? != text {
        let _ = fs::remove_file(&target);
        return Err(LockError::Corrupt);
    }
    let store = crate::history::store_root(&vault.managed_dir());
    let versions = store.join(crate::history::folder_name(&vault.history_key(path)));
    fs::remove_file(path).map_err(system)?;
    if versions.is_dir() {
        let _ = fs::remove_dir_all(&versions);
    }
    Ok(target)
}

/// `.md.enc` の施錠を外して `.md` に戻す。確かめてから暗号文を消す。戻したノートの場所
pub fn unlock_note(path: &Path, key: &Key) -> Result<std::path::PathBuf, LockError> {
    if !super::is_locked_note(path) {
        return Err(LockError::NotLocked);
    }
    let text = read_locked(path, key)?;
    let target = sibling(path, ".md");
    crate::autosave::save_atomic(&target, &text).map_err(system)?;
    if super::read_note(&target).map_err(system)? != text {
        let _ = fs::remove_file(&target);
        return Err(LockError::Corrupt);
    }
    fs::remove_file(path).map_err(system)?;
    Ok(target)
}

/// パスワードを変える: 施錠ノートを全部（ゴミ箱の中も）新しい鍵で書き直す。
/// **まず全部を古い鍵で開けてみて**、1 つでも開けなければ手を付けずに止める
/// （半分だけ新しい鍵になると、どちらのパスワードでも全部は開けなくなる）。
/// 書き直すのは 1 つずつ一時ファイル経由（write_locked）。書き直した数を返す
pub fn change_key(vault: &Vault, old: &Key, new: &Key) -> Result<usize, LockError> {
    let mut targets = vault.scan_locked();
    let mut trashed = Vec::new();
    super::collect_files(&vault.trash_dir(), &mut trashed, super::is_locked_note);
    targets.extend(trashed);
    let mut opened = Vec::with_capacity(targets.len());
    for path in &targets {
        let text = zeroize::Zeroizing::new(read_locked(path, old)?);
        opened.push((path, text));
    }
    for (path, text) in &opened {
        write_locked(path, new, text)?;
    }
    Ok(opened.len())
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::lock::{Key, LockError, Params};
    use crate::test_support::temp_vault;

    fn key() -> Key {
        Key::create("合言葉", Params::FOR_TESTS).unwrap()
    }

    #[test]
    fn test_施錠ノートを書いて読むと元に戻り_ファイルに平文は無い() {
        let (root, _vault) = temp_vault();
        let path = root.path().join("秘密.md.enc");
        let key = key();
        write_locked(&path, &key, "# 秘密\n\n見られたくない語\n").unwrap();
        assert_eq!(
            read_locked(&path, &key).unwrap(),
            "# 秘密\n\n見られたくない語\n"
        );
        let bytes = std::fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("見られたくない"));
    }

    #[test]
    fn test_解錠はパスワードが合えば鍵を返す() {
        let (root, vault) = temp_vault();
        write_locked(&root.path().join("秘密.md.enc"), &key(), "本文").unwrap();
        let unlocked = unlock(&vault, "合言葉").unwrap();
        assert_eq!(
            read_locked(&root.path().join("秘密.md.enc"), &unlocked).unwrap(),
            "本文"
        );
    }

    #[test]
    fn test_解錠はパスワードが違えば断る() {
        let (root, vault) = temp_vault();
        write_locked(&root.path().join("秘密.md.enc"), &key(), "本文").unwrap();
        assert_eq!(
            unlock(&vault, "ちがう").err(),
            Some(LockError::WrongPassword)
        );
    }

    #[test]
    fn test_施錠ノートが無ければ解錠できない() {
        let (_root, vault) = temp_vault();
        assert_eq!(
            unlock(&vault, "合言葉").err(),
            Some(LockError::NoLockedNotes)
        );
    }

    #[test]
    fn test_鍵が違うファイルは読めない() {
        let (root, _vault) = temp_vault();
        let path = root.path().join("秘密.md.enc");
        write_locked(&path, &key(), "本文").unwrap();
        assert_eq!(read_locked(&path, &key()).err(), Some(LockError::OtherKey));
    }

    // ---------------------------------------- 平文を書かせない関所（13-3 / 13-4）

    fn locked_note(root: &std::path::Path, name: &str, text: &str) -> std::path::PathBuf {
        let path = root.join(name);
        write_locked(&path, &key(), text).unwrap();
        path
    }

    #[test]
    fn test_読んで書き戻す道は施錠ノートを書き換えない() {
        // ピン留め・やることの完了・版の復元・リンクの書き換えは全部ここを通る。
        // 通すと暗号文の上に平文を書く
        let (root, vault) = temp_vault();
        let path = locked_note(root.path(), "秘密.md.enc", "本文");
        let before = std::fs::read(&path).unwrap();
        assert!(vault.write_with_version(&path, "x", "平文").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn test_施錠ノートの改名はファイル名だけ変え_中身にも履歴にも触らない() {
        let (root, vault) = temp_vault();
        let path = locked_note(root.path(), "秘密.md.enc", "# 秘密\n");
        let before = std::fs::read(&path).unwrap();
        let renamed = vault.rename(&path, "新しい題").unwrap();
        assert_eq!(renamed, root.path().join("新しい題.md.enc"));
        assert_eq!(std::fs::read(&renamed).unwrap(), before);
        let store = crate::history::store_root(&vault.managed_dir());
        assert!(!store.exists() || crate::history::usage(&store) == 0);
    }

    #[test]
    fn test_施錠ノートは複製しない() {
        let (root, vault) = temp_vault();
        let path = locked_note(root.path(), "秘密.md.enc", "本文");
        assert!(vault.duplicate(&path).is_err());
        assert_eq!(vault.scan().len(), 0, "平文の写しを作らない");
    }

    #[test]
    fn test_施錠ノートは退避しない() {
        let (root, _vault) = temp_vault();
        let dir = tempfile::TempDir::new().unwrap();
        crate::recovery::stash(dir.path(), &root.path().join("秘密.md.enc"), "平文").unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn test_施錠ノートがあれば添付を使っていないとは言わない() {
        // 施錠ノートの中は見られないので、そこだけが使う画像を消してしまう
        let (root, vault) = temp_vault();
        std::fs::write(vault.attachments_dir().join("図.png"), b"png").unwrap();
        assert_eq!(vault.unused_attachments().len(), 1);
        locked_note(root.path(), "秘密.md.enc", "![図](attachments/図.png)");
        assert!(vault.unused_attachments().is_empty());
    }

    // ------------------------------------------- 施錠する・外す・鍵の変更（13-5）

    #[test]
    fn test_施錠すると暗号文の_md_enc_ができ_元の_md_と版は消える() {
        let (root, vault) = temp_vault();
        let plain = crate::test_support::note(root.path(), "仕事/秘密.md", "# 秘密\n\n本文\n");
        vault.keep_version(&plain, "前の本文").unwrap();
        let key = key();
        let locked = lock_note(&vault, &plain, &key).unwrap();
        assert_eq!(locked, root.path().join("仕事/秘密.md.enc"));
        assert_eq!(read_locked(&locked, &key).unwrap(), "# 秘密\n\n本文\n");
        assert!(!plain.exists(), "平文の元を残さない");
        // 決定 4: 施錠する前の平文の版も消す（残すとそこから読める）
        let store = crate::history::store_root(&vault.managed_dir());
        assert!(crate::history::versions(&store, &vault.history_key(&plain)).is_empty());
    }

    #[test]
    fn test_施錠を外すと_md_に戻り_暗号文は消える() {
        let (root, _vault) = temp_vault();
        let key = key();
        let locked = root.path().join("秘密.md.enc");
        write_locked(&locked, &key, "本文\n").unwrap();
        let plain = unlock_note(&locked, &key).unwrap();
        assert_eq!(plain, root.path().join("秘密.md"));
        assert_eq!(std::fs::read_to_string(&plain).unwrap(), "本文\n");
        assert!(!locked.exists());
    }

    #[test]
    fn test_同じ名前があれば枝番で逃がし_上書きしない() {
        let (root, vault) = temp_vault();
        let key = key();
        locked_note(root.path(), "秘密.md.enc", "前からある");
        let plain = crate::test_support::note(root.path(), "秘密.md", "新しく施錠");
        let locked = lock_note(&vault, &plain, &key).unwrap();
        assert_eq!(locked, root.path().join("秘密-2.md.enc"));
    }

    #[test]
    fn test_鍵が違えば施錠を外さず_元を残す() {
        let (root, _vault) = temp_vault();
        let locked = locked_note(root.path(), "秘密.md.enc", "本文");
        assert!(unlock_note(&locked, &key()).is_err());
        assert!(locked.exists());
        assert!(!root.path().join("秘密.md").exists());
    }

    #[test]
    fn test_施錠ノートでないものは外さず_施錠ノートは二重に施錠しない() {
        let (root, vault) = temp_vault();
        let plain = crate::test_support::note(root.path(), "普通.md", "本文");
        assert!(unlock_note(&plain, &key()).is_err());
        let locked = locked_note(root.path(), "秘密.md.enc", "本文");
        assert!(lock_note(&vault, &locked, &key()).is_err());
    }

    #[test]
    fn test_パスワードを変えると全部の施錠ノートが新しい鍵で開き_古い鍵では開かない() {
        let (root, vault) = temp_vault();
        let old = key();
        let a = root.path().join("a.md.enc");
        let b = root.path().join("仕事/b.md.enc");
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();
        write_locked(&a, &old, "甲").unwrap();
        write_locked(&b, &old, "乙").unwrap();
        // ゴミ箱の中も（戻したときに古いパスワードでしか開けないのを避ける）
        let trashed = vault.trash_dir().join("c.md.enc");
        write_locked(&trashed, &old, "丙").unwrap();

        let new = Key::create("新しい合言葉", Params::FOR_TESTS).unwrap();
        assert_eq!(change_key(&vault, &old, &new).unwrap(), 3);
        assert_eq!(read_locked(&a, &new).unwrap(), "甲");
        assert_eq!(read_locked(&b, &new).unwrap(), "乙");
        assert_eq!(read_locked(&trashed, &new).unwrap(), "丙");
        assert!(read_locked(&a, &old).is_err());
    }

    #[test]
    fn test_パスワードの変更で開けないものがあれば手を付ける前に止める() {
        // 半分だけ新しい鍵になると、どちらのパスワードでも全部は開けなくなる
        let (root, vault) = temp_vault();
        let old = key();
        let a = root.path().join("a.md.enc");
        write_locked(&a, &old, "甲").unwrap();
        locked_note(root.path(), "よそ.md.enc", "別の鍵"); // 別の salt
        let before = std::fs::read(&a).unwrap();
        let new = Key::create("新しい合言葉", Params::FOR_TESTS).unwrap();
        assert!(change_key(&vault, &old, &new).is_err());
        assert_eq!(std::fs::read(&a).unwrap(), before);
    }
}
