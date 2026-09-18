// 節の終わり（append_to_note が「見出しの節の末尾」に足すときの境）。
// コードフェンスの中の `#` は見出しに数えない。共有の見本 fixtures/section-cases.json

/// その見出しの節の終わり（次の同じか浅い見出しの手前。無ければ末尾）を
/// バイト位置で返す。見出しが見つからなければ None。
///
/// 規則は TS 側の `src/lib/section.ts`（埋め込みの `#見出し`）と同じ:
/// 深い小見出しは節の中、コードフェンスの中の `#` は見出しに数えない。
pub fn section_end(text: &str, heading: &str) -> Option<usize> {
    let wanted = heading.trim().to_lowercase();
    if wanted.is_empty() {
        return None;
    }
    let mut fence: Option<(char, usize)> = None;
    let mut level = 0usize;
    let mut found = false;
    let mut offset = 0usize;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some((open_char, open_len)) = fence {
            // 閉じは**同じ字で同じ長さ以上**、後ろは空白だけ（CommonMark）。
            // 種類と長さを見ずにトグルすると ```` の中の ``` で閉じてしまう
            if let Some((c, n)) = fence_of(trimmed) {
                if c == open_char && n >= open_len && trimmed[n..].trim().is_empty() {
                    fence = None;
                }
            }
            offset += line.len();
            continue;
        }
        if let Some(opened) = fence_of(trimmed) {
            fence = Some(opened);
            offset += line.len();
            continue;
        }
        if let Some((depth, name)) = heading_of(line) {
            if !found {
                if name.to_lowercase() == wanted {
                    found = true;
                    level = depth;
                }
            } else if depth <= level {
                return Some(offset);
            }
        }
        offset += line.len();
    }
    found.then_some(text.len())
}

/// 行頭（字下げを除く）のコードフェンス。(字, 本数)。3 本未満は None
fn fence_of(trimmed: &str) -> Option<(char, usize)> {
    let first = trimmed.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|c| *c == first).count();
    (count >= 3).then_some((first, count))
}

/// `## 見出し ##` → (深さ, 題)。見出しでなければ None
fn heading_of(line: &str) -> Option<(usize, String)> {
    let depth = line.chars().take_while(|c| *c == '#').count();
    if depth == 0 || depth > 6 {
        return None;
    }
    let rest = &line[depth..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    Some((depth, rest.trim().trim_end_matches('#').trim().to_string()))
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_section_end_共有の見本と同じ答えを出す() {
        // fixtures/section-cases.json は TS 側（lib/section.sectionOf）と同じ見本。
        // section_end は終わりだけ返すので、見出しの行の頭はここで探す
        let raw = include_str!("../../../fixtures/section-cases.json");
        let found: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in found["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let heading = case["heading"].as_str().unwrap();
            let want = case["section"].as_str();
            let got = section_end(text, heading).map(|end| {
                let wanted = heading.trim().to_lowercase();
                let mut offset = 0;
                let mut start = None;
                let mut fence: Option<(char, usize)> = None;
                for line in text.split_inclusive('\n') {
                    let trimmed = line.trim_start();
                    if let Some((c, n)) = fence {
                        if let Some((cc, nn)) = fence_of(trimmed) {
                            if cc == c && nn >= n {
                                fence = None;
                            }
                        }
                    } else if let Some(open) = fence_of(trimmed) {
                        fence = Some(open);
                    } else if let Some((_, name)) = heading_of(line) {
                        if name.to_lowercase() == wanted {
                            start = Some(offset);
                            break;
                        }
                    }
                    offset += line.len();
                }
                let start = start.expect("見出しの行");
                format!("{}\n", text[start..end].trim_end_matches('\n'))
            });
            assert_eq!(got.as_deref(), want, "見本: {text:?} / {heading}");
        }
    }

    #[test]
    fn test_section_end_フェンスは同じ字で同じ長さ以上の行でだけ閉じる() {
        // ```` の中の ``` は閉じない（CommonMark）。TS の section.ts と同じ規則
        let text = "## A\n\n````md\n```\n## 中\n```\n````\n\n## B\n";
        let end = section_end(text, "A").unwrap();
        assert!(text[..end].contains("## 中"), "四本の中の三本で閉じた");
        assert!(!text[..end].contains("## B"));
        // ~~~ は ``` で閉じない
        let mixed = "## A\n\n~~~\n```\n## 中\n~~~\n\n## B\n";
        let end = section_end(mixed, "A").unwrap();
        assert!(mixed[..end].contains("## 中"));
        assert!(!mixed[..end].contains("## B"));
    }

    #[test]
    fn test_section_end_見出しの節の終わり_コードの中の_は数えない() {
        let text = "# 題\n\n## A\n\n本文\n\n```\n## 中\n```\n\n## B\n\n後\n";
        let end = section_end(text, "A").unwrap();
        assert!(
            text[..end].contains("## 中"),
            "コードの中は節の切れ目にしない"
        );
        assert!(!text[..end].contains("## B"));
        assert!(section_end(text, "無い").is_none());
        // 深い小見出しは含み、同じ深さで切れる
        let nested = "## A\n\nあ\n\n### A-1\n\nい\n\n## B\n";
        let end = section_end(nested, "A").unwrap();
        assert!(nested[..end].contains("### A-1"));
        assert!(!nested[..end].contains("## B"));
    }
}
