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
    let (front, rest) = crate::front_matter::split(text);
    let front_lines = front.matches('\n').count();
    let mut found = Vec::new();
    let mut in_fence = false;
    for (offset, line) in rest.lines().enumerate() {
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

/// リストの印（`- ` `* ` `+ ` と `1. ` `12) `）の長さ。印でなければ None。
/// 番号付きもやること（GFM と同じ。棚卸し 2026-09-17 に決めた）
fn list_prefix_len(trimmed: &str) -> Option<usize> {
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        return Some(2);
    }
    let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 9 {
        return None;
    }
    let rest = &trimmed[digits..];
    if rest.starts_with(". ") || rest.starts_with(") ") {
        return Some(digits + 2);
    }
    None
}

/// `- [ ] 文` の形なら（完了か, 文）。`-` `*` `+` と番号付きのどれでも
fn task_marker(trimmed: &str) -> Option<(bool, &str)> {
    let rest = &trimmed[list_prefix_len(trimmed)?..];
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
/// `complete_matching` の答え
#[derive(Debug, PartialEq)]
pub enum Completion {
    /// 完了にした本文
    Rewritten(String),
    /// 既に完了している（別の窓や MCP で済んでいた。何も書かない）
    AlreadyDone,
    /// その行がやることでない・文が違う（一覧がずれている）
    Mismatch,
}

/// 一覧（索引の写し）から来た行番号で完了にする。**文も突き合わせる** — 上に
/// 行が挟まると同じ番号が別のやることを指す（レビュー 2026-09-24 / 21-3）。
/// 完了済みと「ずれ」は分けて返す — 完了済みを「ずれています」と叱っていた
/// （再レビュー 2026-09-25 / 21-6）
pub fn complete_matching(text: &str, line: usize, expected: &str) -> Completion {
    let Some(found) = extract_tasks(text)
        .into_iter()
        .find(|item| item.line == line)
    else {
        return Completion::Mismatch;
    };
    if found.text != expected {
        return Completion::Mismatch;
    }
    if found.done {
        return Completion::AlreadyDone;
    }
    match set_task_done(text, line, true) {
        Some(rewritten) => Completion::Rewritten(rewritten),
        None => Completion::Mismatch,
    }
}

pub fn set_task_done(text: &str, line: usize, done: bool) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut changed = false;
    for (number, piece) in text.split_inclusive('\n').enumerate() {
        if number == line {
            // 行末の改行を外して見る。付けたままだと本文の無い `- [ ]` が
            // `[ ]\n` になって印に見えず、一覧に出るのに完了にできない
            let (piece, newline) = match piece.strip_suffix('\n') {
                Some(body) => (body, "\n"),
                None => (piece, ""),
            };
            let trimmed = piece.trim_start();
            let indent = &piece[..piece.len() - trimmed.len()];
            task_marker(trimmed)?;
            // 印の前（`- ` や `12. `）は元のまま。印だけを差し替える
            let prefix = list_prefix_len(trimmed)?;
            let bullet = &trimmed[..prefix];
            let after = &trimmed[prefix..];
            let mark_len = if after.starts_with("[ ] ")
                || after.starts_with("[x] ")
                || after.starts_with("[X] ")
            {
                4
            } else {
                3
            };
            let tail = &trimmed[prefix + mark_len..];
            out.push_str(indent);
            out.push_str(bullet);
            out.push_str(if done { "[x]" } else { "[ ]" });
            if mark_len == 4 {
                out.push(' ');
            }
            out.push_str(tail);
            out.push_str(newline);
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
    fn test_task_marker_共有の見本と同じ答えを出す() {
        // fixtures/task-marker-cases.json は TS 側（lib/tasks.ts）と同じ見本
        let raw = include_str!("../../fixtures/task-marker-cases.json");
        let found: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in found["cases"].as_array().unwrap() {
            let line = case["line"].as_str().unwrap();
            let want = case["task"].as_object().map(|task| {
                (
                    task["done"].as_bool().unwrap(),
                    task["body"].as_str().unwrap().to_string(),
                )
            });
            let got = task_marker(line.trim_start()).map(|(done, body)| (done, body.to_string()));
            assert_eq!(got, want, "見本: {line:?}");
        }
    }

    #[test]
    fn test_set_task_done_空のやることでも改行付きの行を書き換える() {
        // extract_tasks は lines()（改行なし）で `[ ]` に当たるのに、set_task_done は
        // split_inclusive で `[ ]\n` を見て印を見つけられず、一覧に出るのに完了に
        // できなかった（監査 2026-09-17）
        assert_eq!(
            set_task_done("- [ ]\n- [ ] b\n", 0, true).unwrap(),
            "- [x]\n- [ ] b\n"
        );
        assert_eq!(set_task_done("- [x]\n", 0, false).unwrap(), "- [ ]\n");
    }

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

    /// 一覧の行番号は索引の写しで、上に行が挟まると別のやることを指す
    /// （レビュー 2026-09-24 / 21-3）。文も突き合わせて、違えば触らない
    #[test]
    fn test_complete_matching_文が違えば触らない() {
        let text = "# 題\n\n- [ ] 買い物\n- [ ] 掃除\n";
        assert_eq!(
            complete_matching(text, 2, "買い物"),
            Completion::Rewritten("# 題\n\n- [x] 買い物\n- [ ] 掃除\n".to_string())
        );
        // 上に 1 行挟まって、一覧の行番号 2 が別のやることになった
        let shifted = "# 題\n追加\n\n- [ ] 買い物\n- [ ] 掃除\n";
        assert_eq!(
            complete_matching(shifted, 2, "買い物"),
            Completion::Mismatch
        );
        // 既に完了している行は「ずれ」ではない（21-6）
        assert_eq!(
            complete_matching("- [x] 済み\n", 0, "済み"),
            Completion::AlreadyDone
        );
        assert!(matches!(
            complete_matching(shifted, 3, "買い物"),
            Completion::Rewritten(_)
        ));
    }
}
