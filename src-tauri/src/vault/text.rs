// 本文の読みと見出しの差し替え（fs に依存しない部分）。
// 文字コードの判定は「まず UTF-8、駄目なら Shift_JIS」（TASKS 7-6）

use super::*;

/// バイト列を本文にする（TASKS 7-6。ポメラや Windows で書いた `.txt`）。
///
/// **まず UTF-8。読めなかったときだけ Shift_JIS で読み直す。** 文字コードの
/// 当てずっぽうは危ない（UTF-8 のまま Shift_JIS と決めつけると全部化ける）。
/// UTF-8 として成立するならそれが正しい、と決め打つ。
///
/// **改行は LF に揃える。** CRLF のまま CM6 に渡すと `\r` が字として残り、
/// 行末に見えない文字が付いて回る。書き出しは今までどおり UTF-8 / LF。
pub fn decode_text(bytes: &[u8]) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        // 日本語の `.txt` はほぼ Shift_JIS（ポメラの既定もこれ）
        Err(_) => encoding_rs::SHIFT_JIS.decode(bytes).0.into_owned(),
    };
    // BOM は字ではない（先頭に見えない文字が残ると検索も置換も外れる）
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// ノートの本文を読む。**文字コードの揺れはここで吸収する**（7-6）。
///
/// `fs::read_to_string` を直に使うと、Shift_JIS のノートで失敗して
/// 「無かったこと」になる。ピン留めの見張りや添付の掃除がそれを踏むと、
/// **守るはずのものを守れない**（ピン留めしたノートが捨てられる・
/// 使っている画像がゴミ箱へ行く）。
pub fn read_note(path: &Path) -> io::Result<String> {
    Ok(decode_text(&fs::read(path)?))
}

/// タイトルを付け替えた本文を返す（ADR-0005）。
///
/// タイトルは本文から導かれるので、本文を書き換えるのが唯一の付け替え方。
/// - 見出しがあれば、その行の文字だけを差し替える（深さは保つ）
/// - 見出しが無ければ本文の先頭に `# タイトル` を足す
/// - front matter とコードフェンスの中は見出しとして扱わない
pub fn with_title(text: &str, title: &str) -> String {
    // 見出しは 1 行。改行や連続空白を持ち込ませない
    let cleaned = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return text.to_string();
    }

    let lines: Vec<&str> = text.split('\n').collect();
    let mut in_front_matter = false;
    let mut in_fence = false;
    let mut heading: Option<usize> = None;
    for (number, line) in lines.iter().enumerate() {
        if number == 0 && line.trim_end() == "---" {
            in_front_matter = true;
            continue;
        }
        if in_front_matter {
            if line.trim_end() == "---" {
                in_front_matter = false;
            }
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&hashes)
            && line[hashes..].starts_with(' ')
            && !line[hashes..].trim().is_empty()
        {
            heading = Some(number);
            break;
        }
    }

    match heading {
        Some(number) => {
            let hashes = lines[number].chars().take_while(|c| *c == '#').count();
            let mut replaced = lines.clone();
            let marker = &lines[number][..hashes];
            let new_line = format!("{marker} {cleaned}");
            replaced[number] = &new_line;
            replaced.join("\n")
        }
        None => {
            // **front matter の後ろに**足す。先頭に足すと 1 行目が `---` でなくなり、
            // pinned や id が本文に化ける（再レビュー 2026-09-25 / 21-7。以前は
            // 文書の最先頭に足していた）
            let (front, rest) = crate::front_matter::split(text);
            // 閉じ区切りに改行が無い文書（`---\nid: 1\n---`）では front が改行無しで
            // 終わる。そのまま繋ぐと `---# 題` になり閉じ区切りが消える（21-8）
            let glue = if !front.is_empty() && !front.ends_with('\n') {
                "\n"
            } else {
                ""
            };
            if rest.trim().is_empty() {
                format!("{front}{glue}# {cleaned}\n")
            } else {
                format!("{front}{glue}# {cleaned}\n\n{rest}")
            }
        }
    }
}

/// 末尾に改行が無ければ足す（書き込む本文は LF で終える。3 か所で同じ if を書いていた）
pub fn ensure_trailing_newline(text: &mut String) {
    if !text.ends_with('\n') {
        text.push('\n');
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_UTF8_はそのまま読む() {
        assert_eq!(decode_text("こんにちは\n".as_bytes()), "こんにちは\n");
    }

    #[test]
    fn test_Shift_JIS_も読める_ポメラや_Windows_の_txt() {
        // 「こんにちは」の Shift_JIS
        let sjis = [0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD];
        assert_eq!(decode_text(&sjis), "こんにちは");
    }

    #[test]
    fn test_改行は_LF_に揃える() {
        assert_eq!(decode_text(b"a\r\nb\r\n"), "a\nb\n");
        assert_eq!(decode_text(b"a\rb"), "a\nb"); // 古い Mac の改行
    }

    #[test]
    fn test_BOM_は落とす() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("題".as_bytes());
        assert_eq!(decode_text(&bytes), "題");
    }

    #[test]
    fn test_with_title_見出しの行だけ差し替えて深さを保つ() {
        assert_eq!(with_title("## 旧題\n\n本文\n", "新題"), "## 新題\n\n本文\n");
    }

    #[test]
    fn test_with_title_見出しが無ければ先頭に足す() {
        assert_eq!(with_title("本文だけ\n", "新題"), "# 新題\n\n本文だけ\n");
        assert_eq!(with_title("", "新題"), "# 新題\n");
    }

    #[test]
    fn test_with_title_フェンスとfront_matterの中は見出しではない() {
        let text = "---\ntags: [a]\n---\n```\n# コード\n```\n\n# 本物\n";
        let expected = "---\ntags: [a]\n---\n```\n# コード\n```\n\n# 新題\n";
        assert_eq!(with_title(text, "新題"), expected);
    }

    #[test]
    fn test_with_title_改行入りは1行に畳み_空なら原文のまま() {
        assert_eq!(with_title("# 旧\n", "新\nしい  題"), "# 新 しい 題\n");
        assert_eq!(with_title("# 旧\n", "   "), "# 旧\n");
    }

    #[test]
    fn test_Shift_JIS_を開いて保存すると_UTF8_になる() {
        // 質問 2026-09-06「読み出して、保存するときは UTF-8 に」。
        // 読んだ時点で本文は UTF-8 / LF になっているので、保存すれば
        // ファイルもそちらに揃う（**書き換えるのは保存したときだけ**）
        let root = TempDir::new().unwrap();
        let path = root.path().join("会議.md");
        let sjis = encoding_rs::SHIFT_JIS
            .encode("# 会議\r\n\r\n本文\r\n")
            .0
            .into_owned();
        fs::write(&path, &sjis).unwrap();

        let text = read_note(&path).unwrap();
        assert_eq!(text, "# 会議\n\n本文\n");
        crate::autosave::save_atomic(&path, &text).unwrap();

        let bytes = fs::read(&path).unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), "# 会議\n\n本文\n");
        // 読み直しても同じ（何度開き閉じしても増えない・減らない）
        assert_eq!(read_note(&path).unwrap(), text);
    }

    #[test]
    fn test_ピン留めは文字コードに関わらず読める() {
        // ピン留めの見張り（ゴミ箱へ移せない）が、読めないノートで
        // すり抜けていた
        let root = TempDir::new().unwrap();
        let sjis = encoding_rs::SHIFT_JIS
            .encode("---\npinned: true\n---\n\n# 会議\n")
            .0
            .into_owned();
        let path = root.path().join("会議.md");
        fs::write(&path, sjis).unwrap();
        let text = read_note(&path).unwrap();
        assert!(crate::front_matter::pinned(&text));
    }

    /// 見出しの無いノートに足す見出しは front matter の**後ろ**（21-7）。
    /// 先頭に足すと pinned / id が本文に化ける
    #[test]
    fn test_with_title_見出しが無ければ_front_matter_の後ろに足す() {
        assert_eq!(
            with_title("---\npinned: true\n---\n本文\n", "新"),
            "---\npinned: true\n---\n# 新\n\n本文\n"
        );
        assert!(crate::front_matter::pinned(&with_title(
            "---\npinned: true\n---\n本文\n",
            "新"
        )));
        // front matter だけのノート
        assert_eq!(
            with_title("---\nid: 1\n---\n", "新"),
            "---\nid: 1\n---\n# 新\n"
        );
        // 閉じ区切りに改行が無くても `---# 新` にしない（21-8）
        assert_eq!(
            with_title("---\nid: 1\n---", "新"),
            "---\nid: 1\n---\n# 新\n"
        );
        assert!(crate::front_matter::block_len(&with_title("---\nid: 1\n---", "新")).is_some());
        // front matter の無いノートは今までどおり先頭
        assert_eq!(with_title("本文\n", "新"), "# 新\n\n本文\n");
    }
}
