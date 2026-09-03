// 本文の画像参照を data URL にして返す（ADR-0004 のインライン画像の裏側）。
//
// パスの起点は vault ルート（参照実装 editor_widget.set_image_base と同じ）。
// vault の外を指す参照は扱わない（core/paths.py の規則。contains で守る）。
// WKWebView からローカルファイルを読むには asset プロトコルの scope 設定が
// 要るが、data URL ならガードを自前の contains 一本に寄せられる。

use std::io;
use std::path::Path;

/// 拡張子から MIME を引く。知らない拡張子は octet-stream。
pub fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// vault 内の画像を data URL にして返す。外を指すものと無いものはエラー。
pub fn read_data_url(root: &Path, reference: &Path) -> io::Result<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let full = if reference.is_absolute() {
        reference.to_path_buf()
    } else {
        root.join(reference)
    };
    if !crate::vault::contains(root, &full) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("保管フォルダの外は読まない: {}", reference.display()),
        ));
    }
    let bytes = std::fs::read(&full)?;
    Ok(format!(
        "data:{};base64,{}",
        mime_for(&full),
        STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_mime_for_主な画像形式を引ける() {
        let cases = [
            ("a.png", "image/png"),
            ("a.JPG", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.svg", "image/svg+xml"),
            ("a.bin", "application/octet-stream"),
            ("拡張子なし", "application/octet-stream"),
        ];
        for (name, expected) in cases {
            assert_eq!(mime_for(Path::new(name)), expected, "{name}");
        }
    }

    #[test]
    fn test_read_data_url_vault内の画像をdata_urlにする() {
        let root = TempDir::new().unwrap();
        let dir = root.path().join("attachments");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("dot.png"), [0x89, 0x50, 0x4E, 0x47]).unwrap();

        // 相対参照は vault ルート起点で解決する
        let url = read_data_url(root.path(), Path::new("attachments/dot.png")).unwrap();
        assert_eq!(url, "data:image/png;base64,iVBORw==");
    }

    #[test]
    fn test_read_data_url_vault外は拒否する() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let escape = outside.path().join("x.png");
        fs::write(&escape, [1]).unwrap();

        assert!(read_data_url(root.path(), &escape).is_err());
        assert!(read_data_url(root.path(), Path::new("../x.png")).is_err());
    }

    #[test]
    fn test_read_data_url_無いファイルはエラー() {
        let root = TempDir::new().unwrap();
        assert!(read_data_url(root.path(), Path::new("無い.png")).is_err());
    }
}
