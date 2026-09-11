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

/// タグ `#old` を `#new` に（ADR-0055 / 12-4）。判定は tags.rs のスキャナと
/// 同じ規則（直前が行頭か空白、空白か `#` まで、normalize で比べる）なので、
/// `#旧い話` や `#旧/子` のような別のタグは巻き込まない。front matter と
/// コードの中は触らない。1 箇所も無ければ None
pub fn rename_tag(text: &str, old: &str, new: &str) -> Option<(String, usize)> {
    let target = crate::tags::normalize(old);
    if target.is_empty() || new.is_empty() {
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
        if in_fence {
            out.push_str(line);
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let masked: Vec<char> = crate::tags::mask_inline_code(line).chars().collect();
        let mut index = 0;
        while index < chars.len() {
            let at_tag = masked[index] == '#'
                && chars[index] == '#'
                && (index == 0 || chars[index - 1].is_whitespace());
            if at_tag {
                let mut end = index + 1;
                while end < chars.len() && !masked[end].is_whitespace() && masked[end] != '#' {
                    end += 1;
                }
                if end > index + 1 {
                    let name: String = chars[index + 1..end].iter().collect();
                    if crate::tags::normalize(&name) == target {
                        out.push('#');
                        out.push_str(new);
                        count += 1;
                        index = end;
                        continue;
                    }
                }
            }
            out.push(chars[index]);
            index += 1;
        }
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

    // タグの改名（ADR-0055 / 12-4）。判定は tags.rs のスキャナと同じ規則
    #[test]
    fn test_rename_tag_同じタグだけを変え_前方一致の別タグと階層は巻き込まない() {
        let text = "#旧 と #旧い話 と #旧/子 と 文中#旧 と\n#旧\n";
        let (out, count) = rename_tag(text, "旧", "新").unwrap();
        assert_eq!(out, "#新 と #旧い話 と #旧/子 と 文中#旧 と\n#新\n");
        assert_eq!(count, 2);
    }

    #[test]
    fn test_rename_tag_大小は正規化で同じ_コードとfront_matterは触らない() {
        let text = "---\ntags: [Work]\n---\n#Work と #work\n```\n#work\n```\n`#work` #WORK\n";
        let (out, count) = rename_tag(text, "work", "業務").unwrap();
        assert_eq!(
            out,
            "---\ntags: [Work]\n---\n#業務 と #業務\n```\n#work\n```\n`#work` #業務\n"
        );
        assert_eq!(count, 3);
        assert!(rename_tag("#別", "旧", "新").is_none());
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
