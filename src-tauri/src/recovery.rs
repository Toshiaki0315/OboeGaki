// クラッシュ退避（spec §9 Phase 6 / H-1）。参照実装 storage/autosave.py の
// 該当部の移植。
//
// 未保存の内容をアプリのデータフォルダへ退避する。通常は 800ms で保存される
// ので出番は少ないが、**保存できない状態**（競合の未解決、ディスクエラー）の
// まま落ちたときに書いたものを失わないための保険。
//
// 退避先を vault の中にしないのは、**保存できない理由が vault 側にあること**
// が多いため（権限・容量・同期の衝突）。書けない場所へ保険を置いても保険に
// ならない。
//
// 退避は**プレーンテキスト 2 ファイル**（本文と元のパス）にしてある。
// 復元の仕組み自体が壊れても、Finder から中身を読んで手で救い出せる。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const RECOVERY_DIRNAME: &str = "recovery";
const SOURCE_SUFFIX: &str = "source";
const STASH_SUFFIX: &str = "md";

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Stashed {
    /// 元のノートの絶対パス。
    pub source: String,
    pub text: String,
    /// 退避した時刻（ミリ秒。JS の Date と突き合わせやすい単位）。
    pub stashed_at_ms: i64,
}

/// 退避先。**vault ごとに分ける。**
///
/// 複数の保管フォルダを使い分けている場合、片方の未保存内容がもう片方の
/// 起動時に出てくると混乱する。vault のパスから作った鍵で分離する。
pub fn vault_dir(app_data: &Path, vault_root: &Path) -> PathBuf {
    app_data.join(RECOVERY_DIRNAME).join(key(vault_root))
}

fn key(path: &Path) -> String {
    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(path.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// 未保存の内容を退避する。同じノートの退避は上書きする。
pub fn stash(dir: &Path, note_path: &Path, text: &str) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let key = key(note_path);
    let target = dir.join(format!("{key}.{STASH_SUFFIX}"));
    crate::autosave::save_atomic(&target, text)?;
    crate::autosave::save_atomic(
        &dir.join(format!("{key}.{SOURCE_SUFFIX}")),
        &note_path.to_string_lossy(),
    )?;
    Ok(target)
}

/// 保存できたので退避を捨てる。
pub fn discard(dir: &Path, note_path: &Path) {
    let key = key(note_path);
    let _ = fs::remove_file(dir.join(format!("{key}.{STASH_SUFFIX}")));
    let _ = fs::remove_file(dir.join(format!("{key}.{SOURCE_SUFFIX}")));
}

/// 起動時に拾う。**壊れた退避は黙って飛ばす。**
///
/// 読めない退避のせいで起動できなくなってはいけない（退避を諦めるのは
/// 我慢できるが、起動しないのは我慢できない）。
pub fn pending(dir: &Path) -> Vec<Stashed> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut sources: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some(SOURCE_SUFFIX))
        .collect();
    sources.sort();

    let mut found = Vec::new();
    for source_file in sources {
        let body = source_file.with_extension(STASH_SUFFIX);
        let (Ok(source), Ok(text)) = (fs::read_to_string(&source_file), fs::read_to_string(&body))
        else {
            continue;
        };
        let stashed_at_ms = fs::metadata(&body)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|since| since.as_millis() as i64)
            .unwrap_or(0);
        found.push(Stashed {
            source: source.trim().to_string(),
            text,
            stashed_at_ms,
        });
    }
    found
}

/// 退避を全部捨てる（「復元しない」を選んだとき）。
pub fn clear_all(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.is_dir() {
            continue; // 退避はフラットにしか置かない。手で作られた入れ物は触らない
        }
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_vault_dir_vaultごとに分ける() {
        let base = Path::new("/tmp/app");
        let one = vault_dir(base, Path::new("/notes/A"));
        let other = vault_dir(base, Path::new("/notes/B"));
        assert_ne!(one, other);
        assert!(one.starts_with("/tmp/app/recovery"));
    }

    #[test]
    fn test_stash_と_pending_退避した本文と元のパスが戻る() {
        let dir = TempDir::new().unwrap();
        let note = Path::new("/notes/会議.md");

        stash(dir.path(), note, "# 会議\n\n書きかけ\n").unwrap();

        let found = pending(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source, "/notes/会議.md");
        assert_eq!(found[0].text, "# 会議\n\n書きかけ\n");
        assert!(found[0].stashed_at_ms > 1_600_000_000_000);
    }

    #[test]
    fn test_stash_同じノートは上書きする() {
        let dir = TempDir::new().unwrap();
        let note = Path::new("/notes/会議.md");

        stash(dir.path(), note, "古い").unwrap();
        stash(dir.path(), note, "新しい").unwrap();

        let found = pending(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text, "新しい");
    }

    #[test]
    fn test_discard_保存できたら捨てる() {
        let dir = TempDir::new().unwrap();
        let note = Path::new("/notes/会議.md");
        stash(dir.path(), note, "書きかけ").unwrap();

        discard(dir.path(), note);

        assert!(pending(dir.path()).is_empty());
    }

    #[test]
    fn test_pending_片割れだけの壊れた退避は飛ばす() {
        let dir = TempDir::new().unwrap();
        stash(dir.path(), Path::new("/notes/a.md"), "本文").unwrap();
        // 本文だけ消えた退避（復元しようがない）
        for entry in fs::read_dir(dir.path()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().unwrap() == "md" {
                fs::remove_file(path).unwrap();
            }
        }
        stash(dir.path(), Path::new("/notes/b.md"), "生きている").unwrap();

        let found = pending(dir.path());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text, "生きている");
    }

    #[test]
    fn test_pending_置き場が無ければ空() {
        // 退避が読めないせいで起動できなくなってはいけない
        assert!(pending(Path::new("/存在しない/置き場")).is_empty());
    }

    #[test]
    fn test_clear_all_全部捨てる() {
        let dir = TempDir::new().unwrap();
        stash(dir.path(), Path::new("/notes/a.md"), "本文").unwrap();
        fs::create_dir(dir.path().join("入れ物")).unwrap();

        clear_all(dir.path());

        assert!(pending(dir.path()).is_empty());
        assert!(dir.path().join("入れ物").is_dir()); // 手で作られた入れ物は触らない
    }
}
