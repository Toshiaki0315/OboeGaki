// アトミック書き込み（spec §7.4）。参照実装 hitofude/storage/autosave.py の移植。
//
// 一時ファイルへ書いて fsync してから rename で差し替える。電源断が起きても
// 「古い内容のまま」か「新しい内容」かのどちらかにしかならない。
// 中途半端に切れたファイルが残らないことがノートアプリでは決定的に重要。
//
// 一時ファイルは**同じディレクトリ**に作る（ボリュームをまたぐ rename は
// atomic でない）。名前の一意性は OS に任せる（固定名だと同じ vault を
// 2 プロセスが触ったときに書き込み同士が衝突する）。ドット始まりなので
// Finder や vault::scan の目に入らない。
//
// デバウンスの時間判断（参照実装の Debouncer）はフロント側のタイマーで行う
// ため、ここには持たない。

use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// 一時ファイルの拡張子。クラッシュの残骸の掃除（`sweep_temporaries`）はこの名前を目印にする。
const TEMP_SUFFIX: &str = ".tmp";

/// 残骸と見なす古さ。書いている最中の一時ファイル（別のプロセスのぶんも）を
/// 消さないための猶予
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// テキストを一時ファイル経由でアトミックに書き込む。
pub fn save_atomic(path: &Path, text: &str) -> io::Result<()> {
    save_bytes_atomic(path, text.as_bytes())
}

/// `save_atomic` のバイト列版（添付ファイル用）。改行変換は一切しない。
pub fn save_bytes_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let parent = match path.parent() {
        Some(parent) if parent != Path::new("") => parent,
        _ => Path::new("."),
    };
    fs::create_dir_all(parent)?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
    let mut temporary = tempfile::Builder::new()
        .prefix(&format!(".{file_name}."))
        .suffix(TEMP_SUFFIX)
        .tempfile_in(parent)?;
    temporary.write_all(data)?;
    // 一時ファイルは 0600 で作られ、rename で元を置き換えるので、何もしないと
    // 保存のたびに元の権限（共有フォルダの 0644 など）が失われる。元が在れば
    // その権限を写す（レビュー 2026-09-24 / 21-4）
    if let Ok(meta) = fs::metadata(path) {
        temporary.as_file().set_permissions(meta.permissions())?;
    }
    // fsync してから rename する。これで電源断でも「古いまま」か「新しい」の
    // どちらかにしかならない
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// クラッシュで残った一時ファイル（`.名前.xxxx.tmp`）を掃く。ドット始まりなので
/// scan にも Finder にも出ず、掃かない限り溜まる一方だった（レビュー 2026-09-24）。
/// 1 時間より新しいものは書いている最中かもしれないので残す。消した数を返す。
/// シンボリックリンクは辿らない
pub fn sweep_temporaries(root: &Path) -> usize {
    let mut removed = 0;
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            removed += sweep_temporaries(&path);
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with('.') && name.ends_with(TEMP_SUFFIX)) {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|at| now.duration_since(at).ok())
            .map(|age| age >= STALE_AFTER)
            .unwrap_or(false);
        if stale && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_save_atomic_新規ファイルを書ける() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        save_atomic(&path, "こんにちは\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "こんにちは\n");
    }

    #[test]
    fn test_save_atomic_既存ファイルを置き換える() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "old").unwrap();
        save_atomic(&path, "new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn test_save_atomic_一時ファイルを残さない() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        save_atomic(&path, "x").unwrap();
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("note.md")]);
    }

    #[test]
    fn test_save_atomic_親フォルダが無ければ作る() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("sub/deep/note.md");
        save_atomic(&path, "x").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "x");
    }

    #[test]
    fn test_save_bytes_atomic_改行を変換しない() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.bin");
        save_bytes_atomic(&path, b"a\r\nb\r\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\n");
    }

    /// 元の権限を写す（共有フォルダの 0644 が保存のたびに 0600 にならない。21-4）
    #[test]
    fn test_save_atomic_元の権限を保つ() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "a\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o664)).unwrap();
        save_atomic(&path, "b\n").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o664
        );
    }

    /// 古い残骸だけ掃く。新しい一時ファイルと普通のファイルは触らない
    #[test]
    fn test_sweep_temporaries_古い残骸だけ掃く() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("仕事");
        fs::create_dir_all(&sub).unwrap();
        let stale = sub.join(".a.md.abcd.tmp");
        let fresh = dir.path().join(".b.md.efgh.tmp");
        let note = dir.path().join("c.md");
        for path in [&stale, &fresh, &note] {
            fs::write(path, "x").unwrap();
        }
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 60 * 60);
        fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(sweep_temporaries(dir.path()), 1);
        assert!(!stale.exists());
        assert!(fresh.exists());
        assert!(note.exists());
    }
}
