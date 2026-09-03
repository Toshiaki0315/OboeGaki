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

/// 続柄の長さの上限（M-3）。**関係の名前は短い**（参考文献・元ネタ・前提）。
/// 長い一文は、たまたまコロンが入った地の文なので拾わない。
const MAX_RELATION: usize = 12;

/// 指している先と、そこに付いた続柄の組（M-3）。続柄が無ければ空文字。
///
/// **新しい記法は作らない。** 箇条書きの行の `:` より前を読むだけで、
/// これはただの Markdown — 他のエディタで開いても意味が通る。
///
/// **同じ相手を別の続柄で指せる**ので、組で重複を除く。
pub fn relations(text: &str) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = Vec::new();
    for line in body_lines(text) {
        let relation = relation_of(&line);
        for name in links_in_line(&line) {
            let pair = (name, relation.clone());
            if !found.contains(&pair) {
                found.push(pair);
            }
        }
    }
    found
}

/// その行が付けている続柄。無ければ空。
fn relation_of(line: &str) -> String {
    // **地の文は見ない**（「今日は: [[…]]」を続柄にしないため）。
    // チェックボックス（`- [ ] `）もここで一緒に落とす
    let trimmed = line.trim_start();
    let rest = match trimmed.find([' ', '\t']) {
        Some(at) if is_bullet(&trimmed[..at]) => trimmed[at..].trim_start(),
        _ => return String::new(),
    };
    let rest = rest.strip_prefix("[ ] ").unwrap_or(rest);
    let rest = rest.strip_prefix("[x] ").unwrap_or(rest);
    let rest = rest.strip_prefix("[X] ").unwrap_or(rest);

    // **半角のコロンは後ろに空白が要る** — 無いと `10:30` の「10」や
    // `https://…` の「https」を続柄にしてしまう（日本語のノートでは
    // 時刻がよく出る）。全角は日本語で使われる形なので空白を求めない
    let (name, _) = match rest.find('：') {
        Some(at) => (&rest[..at], at),
        None => match rest.find(": ") {
            Some(at) => (&rest[..at], at),
            None => return String::new(),
        },
    };
    if name.contains('[') || name.contains(']') || name.contains('\n') {
        return String::new();
    }
    let cleaned = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() || cleaned.chars().count() > MAX_RELATION {
        return String::new();
    }
    cleaned
}

fn is_bullet(mark: &str) -> bool {
    // **文字の境目で切る。** バイト位置で切ると `#タグ` のような多バイトの
    // 語で落ちる（実際に踏んだ）
    matches!(mark, "-" | "*" | "+")
        || mark
            .strip_suffix('.')
            .or_else(|| mark.strip_suffix(')'))
            .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
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
    fn test_relations_箇条書きのコロンより前が続柄() {
        let text = "- 参考文献: [[会議メモ]]\n- 元ネタ：[[日報]]\n";
        assert_eq!(
            relations(text),
            vec![
                ("会議メモ".to_string(), "参考文献".to_string()),
                ("日報".to_string(), "元ネタ".to_string()),
            ]
        );
    }

    #[test]
    fn test_relations_地の文は見ない() {
        // 「今日は: [[…]]」を続柄にしない
        assert_eq!(
            relations("今日は: [[会議メモ]] を見た\n"),
            vec![("会議メモ".to_string(), String::new())]
        );
    }

    #[test]
    fn test_relations_半角コロンは後ろに空白が要る() {
        // `10:30` の「10」や `https://…` の「https」を続柄にしない
        assert_eq!(
            relations("- 10:30 [[会議メモ]]\n"),
            vec![("会議メモ".to_string(), String::new())]
        );
    }

    #[test]
    fn test_relations_長い一文は続柄にしない() {
        let text = "- これはたまたまコロンが入った長い地の文です: [[会議メモ]]\n";
        assert_eq!(
            relations(text),
            vec![("会議メモ".to_string(), String::new())]
        );
    }

    #[test]
    fn test_relations_多バイトの語で落ちない() {
        // `#タグ` のような語をバイト位置で切って落ちた（回帰）
        assert_eq!(relations("#タグ 付きの本文 [[会議メモ]]\n").len(), 1);
    }

    #[test]
    fn test_relations_チェックボックスも続柄を読む() {
        assert_eq!(
            relations("- [ ] 前提: [[会議メモ]]\n"),
            vec![("会議メモ".to_string(), "前提".to_string())]
        );
    }

    #[test]
    fn test_relations_同じ相手を別の続柄で指せる() {
        let text = "- 参考文献: [[会議メモ]]\n- 元ネタ: [[会議メモ]]\n";
        assert_eq!(relations(text).len(), 2);
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
