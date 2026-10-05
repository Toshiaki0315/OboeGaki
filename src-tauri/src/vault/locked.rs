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
}
