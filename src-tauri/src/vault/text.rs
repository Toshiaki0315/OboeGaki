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
        // 日本語の `.txt` はほぼ Shift_JIS（ポメラの既定もこれ）。ただし **UTF-8 の字が
        // 並んでいれば UTF-8** — UTF-8 のノートに読めないバイトが 1 つ紛れただけで
        // 全体を Shift_JIS と決めつけると、日本語が丸ごと化け、書き戻す操作（改名・
        // 一括置換・やることの完了…）がそれを保存し、履歴の版も化けたものになった
        // （レビュー 2026-09-29）。そのときは読めないバイトだけを置き換え文字にする
        Err(_) => {
            let (sjis, sjis_broken) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes);
            // Shift_JIS は U+FFFD を持たないので、出てきた数がそのまま読めなかった字の数
            let sjis_errors = if sjis_broken {
                sjis.matches('\u{FFFD}').count()
            } else {
                0
            };
            if looks_like_utf8(bytes, sjis_errors) {
                String::from_utf8_lossy(bytes).into_owned()
            } else {
                // 切れた字など Shift_JIS として誤りがあっても Shift_JIS で読む。置き換え
                // 文字になるのは読めない字だけ（25-3。以前は UTF-8 として読み、全文が化けた）
                sjis.into_owned()
            }
        }
    };
    // BOM は字ではない（先頭に見えない文字が残ると検索も置換も外れる）
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// UTF-8 として読めないバイトがあっても、UTF-8 の字（2 バイト以上）が並んでいれば
/// UTF-8 と見る。Shift_JIS の日本語が UTF-8 の字の並びになることはまず無いので、
/// これは「UTF-8 で書いたノートに読めないバイトが紛れた」形（25-3）。Shift_JIS として
/// 誤りなく読めるかだけでは決められない — UTF-8 の日本語の多くは Shift_JIS としても
/// 誤りなく（化けて）読めてしまう。
///
/// Shift_JIS として誤りなく読める（`sjis_errors` が 0）ときは、UTF-8 の字が壊れたバイト
/// より多いときだけ UTF-8 — 半角カナの Shift_JIS はまれに UTF-8 の字の形になる
/// （`ﾃｽ` = C3 BD）。どちらとしても誤りがあるときは、**読めないところが少ない方**を
/// 取る（同じなら UTF-8）。
///
/// 26-2: 25-3 では常に「2 倍より多い」を求めていて、英語が多い・短い UTF-8 のノートを
/// Shift_JIS と取り違えて化けさせた。docs/ の 2,108 段落で測ると、壊れたバイトを 1 つ
/// 足した UTF-8 の取り違えは 3 通りの足し方で 717 → 4、正しい Shift_JIS の取り違えは
/// 0 のまま、途中で切れた Shift_JIS の取り違えは 1
fn looks_like_utf8(bytes: &[u8], sjis_errors: usize) -> bool {
    let (mut chars, mut broken) = (0usize, 0usize);
    for chunk in bytes.utf8_chunks() {
        chars += chunk.valid().chars().filter(|c| c.len_utf8() > 1).count();
        if !chunk.invalid().is_empty() {
            broken += 1;
        }
    }
    if sjis_errors == 0 {
        chars > broken
    } else {
        broken <= sjis_errors
    }
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
/// - **H1（`# `）**があれば、その行の文字だけを差し替える
/// - H1 が無ければ本文の先頭に `# タイトル` を足す。`##` 以下は題ではないので
///   触らない — 差し替えると、その節の見出しの字が消える（実機報告 2026-10-05。
///   参照実装も深さを問わず最初の見出しを差し替えていたが、題を読む `title_of` と
///   ファイル名の追従は H1 だけを見る。ADR-0005 の「探し方を裏返す」に揃えた）
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
        if line
            .strip_prefix("# ")
            .is_some_and(|rest| !rest.trim().is_empty())
        {
            heading = Some(number);
            break;
        }
    }

    match heading {
        Some(number) => {
            let mut replaced = lines.clone();
            let new_line = format!("# {cleaned}");
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
    fn test_UTF8_に読めないバイトが_1_つ混じっても日本語は化けない() {
        // Latin-1 の é（0xE9）が 1 字だけ紛れた UTF-8 のノート。以前は全体を
        // Shift_JIS として読み直して「繝｡繝｢」と化け、書き戻しでそれを保存した
        let mut bytes = "# メモ\n\n日本語の本文です\ncaf".as_bytes().to_vec();
        bytes.push(0xE9);
        bytes.push(b'\n');
        let text = decode_text(&bytes);
        assert!(
            text.starts_with("# メモ\n\n日本語の本文です\ncaf"),
            "{text}"
        );
        // 読めないバイトだけが置き換え文字になる
        assert_eq!(text.matches('\u{FFFD}').count(), 1, "{text}");
    }

    #[test]
    fn test_Shift_JIS_の途中で切れたノートも_切れた字のほかは読める() {
        // 同期ソフトや書きかけのコピーで、最後の字の途中で切れたポメラの .txt。
        // 以前は Shift_JIS として誤りがあるので UTF-8 として読み、全文が置き換え
        // 文字になった（25-3）。書き戻す操作がそれを保存してしまう
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("# メモ\n\n日本語の本文です\nおわり");
        let mut bytes = sjis.into_owned();
        bytes.push(0x82); // 次の字の 1 バイト目だけ
        let text = decode_text(&bytes);
        assert!(
            text.starts_with("# メモ\n\n日本語の本文です\nおわり"),
            "{text}"
        );
        assert!(text.matches('\u{FFFD}').count() <= 1, "{text}");
    }

    #[test]
    fn test_Shift_JIS_として誤りなく読めても_UTF8_の字が並んでいれば_UTF8() {
        // UTF-8 の日本語の多くは Shift_JIS としても誤りなく読めてしまう（字が化ける
        // だけ）。読めないバイトが 1 つ紛れた UTF-8 のノートを Shift_JIS と決めつけない
        let mut bytes = "あいうえお".as_bytes().to_vec();
        bytes.push(0xFF);
        let text = decode_text(&bytes);
        assert!(text.starts_with("あいうえお"), "{text}");
    }

    #[test]
    fn test_英語が多い_短い_UTF8_のノートに壊れたバイトが混じっても化けない() {
        // UTF-8 の字が少ないノートを Shift_JIS と取り違えて化けさせていた（26-2）。
        // 24-1 までは読めていた形
        let mut english = "see caf\u{e9}".as_bytes().to_vec();
        english.push(0xE9);
        assert_eq!(decode_text(&english), "see caf\u{e9}\u{FFFD}");
        let mut short = "# 買う".as_bytes().to_vec();
        short.push(0xFF);
        assert_eq!(decode_text(&short), "# 買う\u{FFFD}");
    }

    #[test]
    fn test_半角カナの_Shift_JIS_は_Shift_JIS_のまま() {
        // 半角カナの並びはまれに UTF-8 の字の形になる。正しい Shift_JIS を化かさない
        for sample in ["ｱｲｳｴｵ ﾃｽﾄ", "ﾃｽﾄ ﾃﾞｰﾀ ｶﾞｲﾄﾞ ﾒﾓ"]
        {
            let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode(sample);
            assert_eq!(decode_text(&sjis), sample);
        }
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
    fn test_with_title_H1_の行だけ差し替える() {
        assert_eq!(with_title("# 旧題\n\n本文\n", "新題"), "# 新題\n\n本文\n");
    }

    #[test]
    fn test_with_title_見出し2以下は題ではないので_先頭に_H1_を足し_元の見出しは残す() {
        // 実機報告 2026-10-05: 見出しの無い文を貼った新規ノートに題を付けると、3 行目の
        // `## 節` の字が題に置き換わっていた（元の見出しが消え、題も `##` になった）。
        // 題は最初の H1（ADR-0005「title_of の探し方を裏返す」）。`##` は題ではない
        let pasted = "一行目の文。\n二行目の文。\n## 節\n\n中身\n";
        assert_eq!(
            with_title(pasted, "新題"),
            "# 新題\n\n一行目の文。\n二行目の文。\n## 節\n\n中身\n"
        );
        assert_eq!(
            with_title("## 旧題\n\n本文\n", "新題"),
            "# 新題\n\n## 旧題\n\n本文\n"
        );
    }

    #[test]
    fn test_with_title_見出し2の後ろにある_H1_を差し替える() {
        assert_eq!(
            with_title("## 前置き\n\n# 旧題\n", "新題"),
            "## 前置き\n\n# 新題\n"
        );
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
