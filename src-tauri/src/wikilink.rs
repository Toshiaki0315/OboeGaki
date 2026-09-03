// `[[ノート名]]` の名前の扱い（E-6）。参照実装 core/wikilink.py の移植。
//
// ノート同士を繋ぐリンク。**CommonMark ではない**（`::ハイライト::` と同じ
// 立場）。他のアプリで開けばただの文字に見えるが、ソースが真実（T1）なので
// 何も失われない。**ID ではなく名前で結ぶ**（ADR-0011）。
//
// 検出の規則はエディタ側（extended-inline.ts の WikiLink）と揃える:
// 名前に `[` `]` `|` と改行を含まない。中身が空白だけならリンクではない。

use unicode_normalization::UnicodeNormalization;

/// 比較のために名前を揃える。
///
/// `sanitize_filename` の**うち比較に要る 2 段だけ**（NFC 正規化と空白の
/// 畳み込み）を同じ規則で行う。あちらはさらに記号の置換もするが、それは
/// ファイル名の都合で、照合で真似ると `[[a/b]]` が `[[a-b]]` に当たる。
/// NFC に寄せるのは、macOS のファイル名が分解された形で来ることがあるため。
pub fn normalize(name: &str) -> String {
    let composed: String = name.nfc().collect();
    composed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 本文が指しているノート名を、重複を除いて出現順に返す。
///
/// **コードの中は数えない。** ``` ```[[a]]``` ``` はリンクではなくコード例。
/// front matter も見ない（`id` や日時はアプリの管理情報で、リンクが
/// 書かれる場所ではない）。
pub fn links(text: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for line in body_lines(text) {
        for name in links_in_line(&line) {
            if !found.contains(&name) {
                found.push(name);
            }
        }
    }
    found
}

/// `[[name]]` を書いている最初の行（バックリンクの一覧に出す文脈）。無ければ空。
///
/// **ノートの冒頭（preview）では足りない。** 長いノートから指されていると、
/// 冒頭を見ても関係が分からない。行はそのまま返す — マーカーを外すと、
/// どう書かれているかが見えなくなる。
pub fn context_line(text: &str, name: &str) -> String {
    let target = normalize(name).to_lowercase();
    if target.is_empty() {
        return String::new();
    }
    for line in body_lines(text) {
        if links_in_line(&line)
            .iter()
            .any(|found| found.to_lowercase() == target)
        {
            return line.trim().to_string();
        }
    }
    String::new()
}

/// front matter とコードフェンスの外の行だけ（インラインコードは潰す）。
fn body_lines(text: &str) -> Vec<String> {
    let body = match crate::front_matter::block_len(text) {
        Some(len) => &text[len..],
        None => text,
    };
    let mut lines = Vec::new();
    let mut in_fence = false;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        lines.push(crate::tags::mask_inline_code(line));
    }
    lines
}

fn links_in_line(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut found = Vec::new();
    let mut index = 0;
    while index + 1 < chars.len() {
        if chars[index] != '[' || chars[index + 1] != '[' {
            index += 1;
            continue;
        }
        let mut end = index + 2;
        let mut broken = false;
        while end < chars.len() && chars[end] != ']' {
            // 名前に `[` と `|` は入らない（別名の記法は未対応。中途半端に
            // 拾うと名前が壊れる）
            if chars[end] == '[' || chars[end] == '|' {
                broken = true;
                break;
            }
            end += 1;
        }
        if broken || end + 1 >= chars.len() || chars[end + 1] != ']' {
            index += 2;
            continue;
        }
        let name: String = chars[index + 2..end].iter().collect();
        if !name.trim().is_empty() {
            found.push(normalize(&name));
        }
        index = end + 2;
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_links_出現順に重複を除いて返す() {
        let text = "詳細は [[会議メモ]] と [[日報]]、あとで [[会議メモ]] をもう一度\n";
        assert_eq!(links(text), vec!["会議メモ", "日報"]);
    }

    #[test]
    fn test_links_名前は照合できる形に揃えて返す() {
        // 索引に載る形は normalize 済み（空白の畳み込み）。生のまま載せると
        // `[[会議  メモ]]` が「会議 メモ」というノートに当たらない
        assert_eq!(links("[[  会議  メモ  ]]\n"), vec!["会議 メモ"]);
    }

    #[test]
    fn test_links_コードの中は数えない() {
        let fenced = "```md\n[[コード例]]\n```\n\n[[本物]]\n";
        assert_eq!(links(fenced), vec!["本物"]);
        assert_eq!(links("これは `[[コード例]]` です"), Vec::<String>::new());
    }

    #[test]
    fn test_links_front_matterは見ない() {
        let text = "---\ntitle: [[管理情報]]\n---\n\n[[本文]]\n";
        assert_eq!(links(text), vec!["本文"]);
    }

    #[test]
    fn test_links_名前が空や閉じていないものは拾わない() {
        assert_eq!(
            links("[[]] と [[  ]] と [[閉じない\n"),
            Vec::<String>::new()
        );
        // 別名の記法は未対応。中途半端に拾うと名前が壊れる
        assert_eq!(links("[[名前|表示]]\n"), Vec::<String>::new());
    }

    #[test]
    fn test_normalize_空白を畳んでnfcに寄せる() {
        assert_eq!(normalize("  会議  メモ  "), "会議 メモ");
        // 分解された「が」（か + 濁点）を合成形に揃える
        assert_eq!(normalize("か\u{3099}"), "が");
    }

    #[test]
    fn test_context_line_指している行をそのまま返す() {
        let text = "# 題\n\n前の行。\n打ち合わせは [[会議メモ]] を見よ。\n";
        assert_eq!(
            context_line(text, "会議メモ"),
            "打ち合わせは [[会議メモ]] を見よ。"
        );
        assert_eq!(context_line(text, "無い"), "");
    }

    #[test]
    fn test_context_line_大小は無視する() {
        let text = "参照: [[Meeting]]\n";
        assert_eq!(context_line(text, "meeting"), "参照: [[Meeting]]");
    }
}
