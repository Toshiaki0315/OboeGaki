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

/// 一時ファイルの拡張子。クラッシュの残骸の掃除はこの名前を目印にする。
pub const TEMP_SUFFIX: &str = ".tmp";

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
    // fsync してから rename する。これで電源断でも「古いまま」か「新しい」の
    // どちらかにしかならない
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
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
}
