// パスの算術: ファイル名の正規化・一意な名前・封じ込め・NFC。
// vault の中の全モジュールが使う土台（19-2 で vault.rs から分けた）

use super::*;

pub(super) fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}

/// フォルダの中（子孫も含む）にファイルが残っているか。
/// macOS が勝手に置く `.DS_Store` は「残っている」に数えない。
pub(super) fn has_files(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return true; // 読めないなら安全側（消さない）
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if has_files(&path) {
                return true;
            }
        } else if path.file_name().and_then(|name| name.to_str()) != Some(IGNORED_FILE) {
            return true;
        }
    }
    false
}

pub(super) fn outside_error(message: &str, path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{message}: {}", path.display()),
    )
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_SUFFIXES.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// タイトルをファイル名に使える形へ直す（spec §7.1）。
///
/// NFC 正規化 → 制御文字を除去 → `/:\` を `-` に → 空白を 1 つに畳む →
/// 先頭のドットを剥がす（隠しファイル化を防ぐ）→ 200 バイト以内に切り詰め。
/// 空になったら「無題」。
pub fn sanitize_filename(title: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let mut text = String::new();
    for character in title.nfc() {
        // Python の isprintable 相当の近似: 制御文字（空白は残す）と
        // 不可視の書式文字（ZWSP や BOM など）を落とす
        if (character.is_control() && !character.is_whitespace()) || is_format_char(character) {
            continue;
        }
        // パス区切りと、Finder が嫌う `:` をハイフンに
        if matches!(character, '/' | ':' | '\\') {
            text.push('-');
        } else {
            text.push(character);
        }
    }
    // 空白を 1 つに畳んで前後を落とし、先頭のドットを剥がす（隠しファイル化を防ぐ）
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut result = collapsed.trim_start_matches('.').trim().to_string();
    while result.len() > MAX_FILENAME_BYTES {
        result.pop();
    }
    if result.is_empty() {
        UNTITLED.to_string()
    } else {
        result
    }
}

/// 不可視の書式文字（Unicode の Cf のうち題名に紛れ込みやすいもの）。TS の
/// `\p{Cf}` と揃える（棚卸し 2026-09-17: ソフトハイフン U+00AD が片側だけ残った）
pub(super) fn is_format_char(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
    )
}

pub(super) fn is_same_file(candidate: &Path, other: Option<&Path>) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Some(other) = other else {
        return false;
    };
    // 同じ実体を指しているか。名前ではなく実体で見る（APFS の既定は
    // 大文字小文字を区別しないので、名前を比べると別物に見える）
    match (fs::metadata(candidate), fs::metadata(other)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// 重複しないパスを返す。衝突したら `-2`, `-3` を付ける（spec §7.1）。
///
/// `ignoring` に動かそうとしている当人を渡すと、それは衝突と数えない。
/// 渡さないと、大文字小文字だけ変えた改名で自分自身を衝突相手と見て
/// `-2` が付く（APFS は大文字小文字を区別しないため）。
pub fn unique_path(directory: &Path, stem: &str, suffix: &str, ignoring: Option<&Path>) -> PathBuf {
    let mut candidate = directory.join(format!("{stem}{suffix}"));
    let mut index = 2;
    while candidate.exists() && !is_same_file(&candidate, ignoring) {
        candidate = directory.join(format!("{stem}-{index}{suffix}"));
        index += 1;
    }
    candidate
}

pub fn nfc_under(root: &Path, path: &Path) -> PathBuf {
    use unicode_normalization::UnicodeNormalization;
    let Ok(relative) = path.strip_prefix(root) else {
        return path.to_path_buf();
    };
    let composed: String = relative.to_string_lossy().nfc().collect();
    root.join(composed)
}

/// 競合コピーの置き場を決める（spec §7.5 の「両方残す」）。
/// `名前 (競合 YYYY-MM-DD).md` の形。同名があれば連番で逃がす。
pub fn conflict_copy_path(path: &Path, date: &str) -> PathBuf {
    let folder = path.parent().unwrap_or(Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(UNTITLED);
    unique_path(folder, &format!("{stem} (競合 {date})"), ".md", None)
}

/// `candidate` が vault の中に留まるか。Tauri commands の入口で必ず通す。
///
/// 実在する部分を canonicalize して判定する（シンボリックリンク越しの
/// 脱出や `..` を防ぐ）。ファイル自体がまだ無ければ親フォルダで判定する
/// （新規保存の経路）。判定の規則は `inside` と同じ「外を指すものは扱わない」。
pub fn contains(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let target = if candidate.exists() {
        candidate.to_path_buf()
    } else {
        match candidate.parent() {
            Some(parent) => parent.to_path_buf(),
            None => return false,
        }
    };
    match target.canonicalize() {
        Ok(resolved) => resolved.starts_with(&root),
        Err(_) => false,
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::blank_note;
    use std::fs;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    #[test]
    fn test_nfc_under_相対部分だけをNFCに揃え_rootは触らない() {
        // 実機 2026-09-09: テキストエディタ（Cocoa）は NFD のパスで書くので、
        // 監視イベントが NFD で届き、索引に同じノートが 2 行できた
        let nfd = "99_テスト/2026年次世代AIフ\u{309A}ロシ\u{3099}ェクト.md";
        let nfc = "99_テスト/2026年次世代AIプロジェクト.md";
        let root = Path::new("/v/ノ\u{3099}ート"); // root 自体が NFD でも据え置く
        assert_eq!(nfc_under(root, &root.join(nfd)), root.join(nfc));
        // root の外は触らない
        assert_eq!(
            nfc_under(root, Path::new("/other/x.md")),
            PathBuf::from("/other/x.md")
        );
    }

    #[test]
    fn test_contains_中のファイルは通し外のファイルは弾く() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let inner = blank_note(root.path(), "sub/a.md");
        let escape = blank_note(outside.path(), "b.md");

        assert!(contains(root.path(), &inner));
        assert!(!contains(root.path(), &escape));
    }

    #[test]
    fn test_contains_ドットドットでの脱出を弾く() {
        let root = TempDir::new().unwrap();
        let outside = blank_note(root.path().parent().unwrap(), "escape.md");
        let sneaky = root.path().join("..").join(outside.file_name().unwrap());
        assert!(!contains(root.path(), &sneaky));
    }

    #[test]
    fn test_contains_外を指すリンク越しの書き込みを弾く() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), root.path().join("linkdir")).unwrap();

        assert!(!contains(root.path(), &root.path().join("linkdir/x.md")));
    }

    #[test]
    fn test_contains_まだ無いファイルは親フォルダで判定する() {
        let root = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("sub")).unwrap();

        assert!(contains(root.path(), &root.path().join("sub/new.md")));
        assert!(!contains(root.path(), Path::new("/no/such/dir/new.md")));
    }

    #[test]
    fn test_sanitize_共有の見本と同じ答えを出す() {
        // fixtures/filename-cases.json は TS 側（note-title.sanitizeStem）と同じ見本
        let raw = include_str!("../../../fixtures/filename-cases.json");
        let found: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in found["cases"].as_array().unwrap() {
            let title = case["title"].as_str().unwrap();
            let want = case["stem"].as_str().unwrap();
            assert_eq!(sanitize_filename(title), want, "見本: {title:?}");
        }
    }

    #[test]
    fn test_sanitize_日本語のタイトルはそのまま通る() {
        assert_eq!(sanitize_filename("会議の記録"), "会議の記録");
    }

    #[test]
    fn test_sanitize_パス区切りとコロンをハイフンに変える() {
        assert_eq!(sanitize_filename("a/b:c\\d"), "a-b-c-d");
    }

    #[test]
    fn test_sanitize_空白を畳んで前後を落とす() {
        assert_eq!(sanitize_filename("  a \t b\n c  "), "a b c");
    }

    #[test]
    fn test_sanitize_先頭のドットを剥がす() {
        assert_eq!(sanitize_filename("...secret"), "secret");
    }

    #[test]
    fn test_sanitize_制御文字を除去する() {
        assert_eq!(sanitize_filename("a\u{0007}b\u{200B}c"), "abc");
    }

    #[test]
    fn test_sanitize_200バイトに文字境界で切り詰める() {
        let long = "あ".repeat(100); // 300 バイト
        let result = sanitize_filename(&long);
        assert!(result.len() <= 200);
        assert_eq!(result, "あ".repeat(66)); // 66 × 3 = 198 バイト
    }

    #[test]
    fn test_sanitize_空になったら無題() {
        assert_eq!(sanitize_filename("   "), "無題");
        assert_eq!(sanitize_filename("..."), "無題");
    }

    #[test]
    fn test_unique_path_衝突が無ければそのままの名前() {
        let dir = TempDir::new().unwrap();
        assert_eq!(
            unique_path(dir.path(), "a", ".md", None),
            dir.path().join("a.md")
        );
    }

    #[test]
    fn test_unique_path_衝突したら連番を付ける() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("a-2.md"), "").unwrap();
        assert_eq!(
            unique_path(dir.path(), "a", ".md", None),
            dir.path().join("a-3.md")
        );
    }

    #[test]
    fn test_unique_path_当人は衝突相手にしない() {
        let dir = TempDir::new().unwrap();
        let own = dir.path().join("a.md");
        fs::write(&own, "").unwrap();
        assert_eq!(unique_path(dir.path(), "a", ".md", Some(&own)), own);
    }

    #[test]
    fn test_conflict_copy_path_競合の名前を作り_同名は連番で逃がす() {
        let dir = TempDir::new().unwrap();
        let base = blank_note(dir.path(), "会議.md");
        let copy = conflict_copy_path(&base, "2026-09-04");
        assert_eq!(copy, dir.path().join("会議 (競合 2026-09-04).md"));

        blank_note(dir.path(), "会議 (競合 2026-09-04).md");
        let second = conflict_copy_path(&base, "2026-09-04");
        assert_eq!(second, dir.path().join("会議 (競合 2026-09-04)-2.md"));
    }
}
