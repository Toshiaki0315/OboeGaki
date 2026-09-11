// 本文の文字列置換（ADR-0055、TASKS 12-3）。純関数。
//
// front matter は触らない。コードフェンスとインラインコードの中は既定で
// 触らない（`include_code` で含める）。大小の区別は選べる。

/// `from` を `to` に置き換えた本文と、置き換えた箇所の数。1 箇所も無ければ None。
/// front matter は触らない。コードの中は `include_code` のときだけ。
pub fn replace_outside_code(
    text: &str,
    from: &str,
    to: &str,
    case_sensitive: bool,
    include_code: bool,
) -> Option<(String, usize)> {
    if from.is_empty() {
        return None;
    }
    let (head, body) = match crate::front_matter::block_len(text) {
        Some(len) => text.split_at(len),
        None => ("", text),
    };
    let mut out = String::with_capacity(text.len());
    out.push_str(head);
    let mut count = 0;
    let mut in_fence = false;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence && !include_code {
            out.push_str(line);
            continue;
        }
        let (replaced, n) = replace_line(line, from, to, case_sensitive, include_code);
        count += n;
        out.push_str(&replaced);
    }
    if count == 0 {
        None
    } else {
        Some((out, count))
    }
}

/// 1 行の中を置き換える。インラインコードの位置は mask で見て飛ばす
/// （mask は文字数を変えない）。大小無視は文字ごとの小文字化で比べる
fn replace_line(
    line: &str,
    from: &str,
    to: &str,
    case_sensitive: bool,
    include_code: bool,
) -> (String, usize) {
    let chars: Vec<char> = line.chars().collect();
    let masked: Vec<char> = if include_code {
        chars.clone()
    } else {
        crate::tags::mask_inline_code(line).chars().collect()
    };
    let needle: Vec<char> = from.chars().collect();
    let fold = |c: char| -> char {
        if case_sensitive {
            c
        } else {
            c.to_lowercase().next().unwrap_or(c)
        }
    };
    let needle_folded: Vec<char> = needle.iter().map(|c| fold(*c)).collect();
    let mut out = String::with_capacity(line.len());
    let mut count = 0;
    let mut index = 0;
    while index < chars.len() {
        let end = index + needle.len();
        // mask された文字（コードの中）が 1 つでも混じる範囲は当てない
        let matches = end <= chars.len()
            && (index..end).all(|k| masked[k] == chars[k])
            && (0..needle.len()).all(|k| fold(chars[index + k]) == needle_folded[k]);
        if matches {
            out.push_str(to);
            count += 1;
            index = end;
        } else {
            out.push(chars[index]);
            index += 1;
        }
    }
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_outside_code_置き換えた本文と箇所の数() {
        let text = "旧い話と旧い歌\n\n旧い\n";
        let (out, count) = replace_outside_code(text, "旧い", "新しい", true, false).unwrap();
        assert_eq!(out, "新しい話と新しい歌\n\n新しい\n");
        assert_eq!(count, 3);
    }

    #[test]
    fn test_replace_outside_code_コードとfront_matterは既定で触らない() {
        let text = "---\ntitle: 旧い\n---\n旧い\n```\n旧い\n```\n`旧い` と 旧い\n";
        let (out, count) = replace_outside_code(text, "旧い", "新", true, false).unwrap();
        assert_eq!(
            out,
            "---\ntitle: 旧い\n---\n新\n```\n旧い\n```\n`旧い` と 新\n"
        );
        assert_eq!(count, 2);
        // include_code ならコードの中も（front matter は変わらず触らない）
        let (out, count) = replace_outside_code(text, "旧い", "新", true, true).unwrap();
        assert_eq!(out, "---\ntitle: 旧い\n---\n新\n```\n新\n```\n`新` と 新\n");
        assert_eq!(count, 4);
    }

    #[test]
    fn test_replace_outside_code_大小を無視できる_無ければnone() {
        let (out, count) = replace_outside_code("Foo foo FOO", "foo", "bar", false, false).unwrap();
        assert_eq!(out, "bar bar bar");
        assert_eq!(count, 3);
        assert!(replace_outside_code("Foo", "foo", "bar", true, false).is_none());
        assert!(replace_outside_code("abc", "", "x", true, false).is_none());
    }
}
