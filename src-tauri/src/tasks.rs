// やること（`- [ ]` / `- [x]`）の抽出と完了の書き換え（ADR-0056、TASKS 12-5）。
//
// 索引に載せて全ノート横断の一覧を出す。期限は行の中の `@2026-09-30` か
// `📅 2026-09-30` の形だけを読む（新しい記法を作らない）。

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskItem {
    /// 0 始まりの行番号（本文全体の中で）
    pub line: usize,
    /// `[ ]` のあとの文（前後の空白は落とす）
    pub text: String,
    pub done: bool,
    /// `YYYY-MM-DD`。行の中の `@日付` か `📅 日付`
    pub due: Option<String>,
}

/// `- [ ] 文` / `- [x] 文` の行を、front matter とコードフェンスの外から拾う。
/// 入れ子（字下げ）も 1 件ずつ。行番号は本文全体の中の位置（飛ばした行も数える）
pub fn extract_tasks(text: &str) -> Vec<TaskItem> {
    let front = crate::front_matter::block_len(text).unwrap_or(0);
    let front_lines = text[..front].matches('\n').count();
    let mut found = Vec::new();
    let mut in_fence = false;
    for (offset, line) in text[front..].lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if let Some((done, body)) = task_marker(trimmed) {
            found.push(TaskItem {
                line: front_lines + offset,
                text: body.trim().to_string(),
                done,
                due: due_of(body),
            });
        }
    }
    found
}

/// `- [ ] 文` の形なら（完了か, 文）。`-` `*` `+` のどれでも
fn task_marker(trimmed: &str) -> Option<(bool, &str)> {
    let rest = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix("+ "))?;
    let (mark, body) = if let Some(body) = rest.strip_prefix("[ ] ") {
        (false, body)
    } else if let Some(body) = rest
        .strip_prefix("[x] ")
        .or_else(|| rest.strip_prefix("[X] "))
    {
        (true, body)
    } else if rest == "[ ]" {
        (false, "")
    } else if rest == "[x]" || rest == "[X]" {
        (true, "")
    } else {
        return None;
    };
    Some((mark, body))
}

/// 行の中の期限。`@2026-09-30` か `📅 2026-09-30`（空白は任意）
fn due_of(body: &str) -> Option<String> {
    let chars: Vec<char> = body.chars().collect();
    let is_date = |from: usize| -> Option<String> {
        if from + 10 > chars.len() {
            return None;
        }
        let candidate: String = chars[from..from + 10].iter().collect();
        let bytes = candidate.as_bytes();
        let ok = candidate.len() == 10
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && candidate.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    c == '-'
                } else {
                    c.is_ascii_digit()
                }
            });
        // 続きが数字なら日付ではない（@2026-09-301 など）
        if ok && chars.get(from + 10).map(|c| c.is_ascii_digit()) != Some(true) {
            Some(candidate)
        } else {
            None
        }
    };
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '@' {
            if let Some(found) = is_date(index + 1) {
                return Some(found);
            }
        }
        if chars[index] == '\u{1F4C5}' {
            let mut next = index + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if let Some(found) = is_date(next) {
                return Some(found);
            }
        }
        index += 1;
    }
    None
}

/// その行の印だけを書き換えた本文。行が無い・印が無ければ None
pub fn set_task_done(text: &str, line: usize, done: bool) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut changed = false;
    for (number, piece) in text.split_inclusive('\n').enumerate() {
        if number == line {
            let trimmed = piece.trim_start();
            let indent = &piece[..piece.len() - trimmed.len()];
            task_marker(trimmed)?;
            // 印の前（`- `）は元のまま。印だけを差し替える
            let bullet = &trimmed[..2];
            let mark_len = if trimmed[2..].starts_with("[ ] ")
                || trimmed[2..].starts_with("[x] ")
                || trimmed[2..].starts_with("[X] ")
            {
                4
            } else {
                3
            };
            let tail = &trimmed[2 + mark_len..];
            out.push_str(indent);
            out.push_str(bullet);
            out.push_str(if done { "[x]" } else { "[ ]" });
            if mark_len == 4 {
                out.push(' ');
            }
            out.push_str(tail);
            changed = true;
        } else {
            out.push_str(piece);
        }
    }
    if changed {
        Some(out)
    } else {
        None
    }
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tasks_未完了と完了_入れ子_期限() {
        let text = "# 題\n\n- [ ] 買い物 @2026-09-30\n  - [x] 牛乳\n* [ ] 📅 2026-10-01 会議の準備\n- ふつうの箇条書き\n";
        let found = extract_tasks(text);
        assert_eq!(found.len(), 3);
        assert_eq!(
            found[0],
            TaskItem {
                line: 2,
                text: "買い物 @2026-09-30".into(),
                done: false,
                due: Some("2026-09-30".into())
            }
        );
        assert_eq!(
            found[1],
            TaskItem {
                line: 3,
                text: "牛乳".into(),
                done: true,
                due: None
            }
        );
        assert_eq!(found[2].due.as_deref(), Some("2026-10-01"));
        assert_eq!(found[2].text, "📅 2026-10-01 会議の準備");
    }

    #[test]
    fn test_extract_tasks_コードとfront_matterは見ない() {
        let text = "---\ntodo: - [ ] x\n---\n```\n- [ ] コード\n```\n- [ ] 本物\n";
        let found = extract_tasks(text);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text, "本物");
        assert_eq!(found[0].line, 6);
    }

    #[test]
    fn test_set_task_done_その行だけを書き換える_違う行や印の無い行はnone() {
        let text = "- [ ] a\n- [ ] b\n";
        assert_eq!(set_task_done(text, 1, true).unwrap(), "- [ ] a\n- [x] b\n");
        assert_eq!(set_task_done("- [X] a\n", 0, false).unwrap(), "- [ ] a\n");
        assert!(set_task_done(text, 5, true).is_none());
        assert!(set_task_done("ただの行\n", 0, true).is_none());
    }
}
