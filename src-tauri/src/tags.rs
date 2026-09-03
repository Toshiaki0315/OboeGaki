// タグの抽出（参照実装 core/tags.py の移植）。
//
// コードフェンスの内側とインラインコードは走査しない。`#include` や
// `#!/bin/sh` がタグツリーに現れると実用にならないため。
// 正規化は「小文字フルパス」（spec §7.3）。

/// 正規化済みタグを、重複を除いて出現順に返す。
pub fn extract_tags(text: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for tag in tags_in_line(&mask_inline_code(line)) {
            if !found.contains(&tag) {
                found.push(tag);
            }
        }
    }
    found
}

/// 索引に載せる形へ揃える（spec §7.3: 小文字フルパス）。
fn normalize(raw: &str) -> String {
    raw.split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
        .to_lowercase()
}

/// インラインコードを非空白文字で潰す。長さは変えない（オフセットを保ち、
/// `` `code`#tag `` の `#` を「直前が空白」と誤認させないため）。
fn mask_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = chars.clone();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '`' {
            index += 1;
            continue;
        }
        let mut ticks = index;
        while ticks < chars.len() && chars[ticks] == '`' {
            ticks += 1;
        }
        let width = ticks - index;
        // 同じ数のバッククォートで閉じる箇所を探す
        let mut close = ticks;
        let mut run = 0;
        let mut end = None;
        while close < chars.len() {
            if chars[close] == '`' {
                run += 1;
                if run == width && chars.get(close + 1) != Some(&'`') {
                    end = Some(close + 1);
                    break;
                }
            } else {
                run = 0;
            }
            close += 1;
        }
        match end {
            Some(finish) => {
                for masked in out.iter_mut().take(finish).skip(index) {
                    *masked = 'x';
                }
                index = finish;
            }
            None => break, // 閉じが無い。残りは素のまま
        }
    }
    out.into_iter().collect()
}

fn tags_in_line(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut found = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '#' {
            index += 1;
            continue;
        }
        // 直前は行頭か空白（URL の #anchor を拾わない）
        if index > 0 && !chars[index - 1].is_whitespace() {
            index += 1;
            continue;
        }
        let mut end = index + 1;
        while end < chars.len() && !chars[end].is_whitespace() && chars[end] != '#' {
            end += 1;
        }
        if end > index + 1 {
            found.push(normalize(&chars[index + 1..end].iter().collect::<String>()));
        }
        index = end.max(index + 1);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_基本と正規化と重複除去() {
        let text = "本文の #タグ と #Work/会議 と #タグ をもう一度\n";
        assert_eq!(extract_tags(text), vec!["タグ", "work/会議"]);
    }

    #[test]
    fn test_extract_直前が行頭か空白のときだけ() {
        assert_eq!(extract_tags("#行頭 はタグ"), vec!["行頭"]);
        assert_eq!(
            extract_tags("https://example.com/#anchor は拾わない"),
            Vec::<String>::new()
        );
        assert_eq!(extract_tags("a#b も拾わない"), Vec::<String>::new());
    }

    #[test]
    fn test_extract_コードの中は走査しない() {
        let fenced = "```sh\n#!/bin/sh\n#include も無視\n```\n\n#本物\n";
        assert_eq!(extract_tags(fenced), vec!["本物"]);
        // インラインコードの中も、コード直後（非空白が続く形）も拾わない
        assert_eq!(
            extract_tags("これは `#code` で、`x`#直後 も拾わない"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn test_extract_名前が空なら拾わない() {
        assert_eq!(extract_tags("# 見出しはタグではない"), Vec::<String>::new());
    }
}
