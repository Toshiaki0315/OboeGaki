// front matter の最小解釈（TASKS 2-3、spec §7.2 / §7.3）。
//
// 1 行目がちょうど `---` で始まり、行頭の `---` で閉じられている場合だけ
// front matter（TS 側 editor/frontmatter.ts と同じ規則）。メタデータが
// 壊れていても本文は必ず扱える（G3）— YAML 全体は解釈せず、必要な鍵の
// 行だけを読む・書く。他の行は原文のまま残す（再ダンプすると引用符や
// コメントが失われる — 参照実装 FrontMatter.raw と同じ理由）。

/// front matter ブロックの長さ（閉じ区切りの改行まで含む）。無ければ None。
pub fn block_len(text: &str) -> Option<usize> {
    let rest = text.strip_prefix("---")?;
    let first_break = rest.find('\n')?;
    if !rest[..first_break].trim_end_matches([' ', '\t']).is_empty() {
        return None; // `---abc` はただの本文
    }
    let mut offset = 3 + first_break + 1;
    for line in text[offset..].split_inclusive('\n') {
        let body = line.strip_suffix('\n').unwrap_or(line);
        if body.trim_end_matches([' ', '\t']) == "---" {
            return Some(offset + line.len());
        }
        offset += line.len();
    }
    None // 閉じが無ければただの水平線で始まる本文
}

/// front matter（区切りごと）と本文に分ける。無ければ front は空。
/// 7 か所で `block_len` + `split_at` を書いていた（19-3）
pub fn split(text: &str) -> (&str, &str) {
    match block_len(text) {
        Some(len) => text.split_at(len),
        None => ("", text),
    }
}

/// front matter を落とした本文
pub fn body(text: &str) -> &str {
    split(text).1
}

/// `pinned: true` が立っているか（spec §7.3）。
pub fn pinned(text: &str) -> bool {
    let Some(end) = block_len(text) else {
        return false;
    };
    text[..end].lines().skip(1).any(|line| {
        line.strip_prefix("pinned:")
            .map(|value| value.trim() == "true")
            .unwrap_or(false)
    })
}

/// `pinned` を立てる / 外した本文を返す。他のメタデータの行は触らない。
pub fn with_pinned(text: &str, value: bool) -> String {
    match (block_len(text), value) {
        (None, false) => text.to_string(),
        (None, true) => format!("---\npinned: true\n---\n{text}"),
        (Some(end), _) => {
            // front matter の中身から既存の pinned 行を外す
            let inner: Vec<&str> = text[..end]
                .lines()
                .skip(1)
                .take_while(|line| line.trim_end_matches([' ', '\t']) != "---")
                .filter(|line| !line.starts_with("pinned:"))
                .collect();
            let body = &text[end..];
            if value {
                let mut lines = inner;
                lines.push("pinned: true");
                format!("---\n{}\n---\n{body}", lines.join("\n"))
            } else if inner.is_empty() {
                // 他に何も残らないなら front matter ごと外す
                body.to_string()
            } else {
                format!("---\n{}\n---\n{body}", inner.join("\n"))
            }
        }
    }
}

/// front matter の中の `key:` の行
fn is_key_line(line: &str, key: &str) -> bool {
    line.strip_prefix(key)
        .is_some_and(|rest| rest.starts_with(':'))
}

/// front matter の `key: 値` を読む（平らな 1 行の値だけ。引用符は外す）。
/// 無ければ None。本文の同じ字面は見ない
pub fn value(text: &str, key: &str) -> Option<String> {
    let end = block_len(text)?;
    text[..end]
        .lines()
        .skip(1)
        .take_while(|line| line.trim_end_matches([' ', '\t']) != "---")
        .find(|line| is_key_line(line, key))
        .map(|line| unquote(line[key.len() + 1..].trim()))
        .filter(|found| !found.is_empty())
}

fn unquote(raw: &str) -> String {
    if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        return raw[1..raw.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
    }
    if raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'') {
        return raw[1..raw.len() - 1].replace("''", "'");
    }
    raw.to_string()
}

/// YAML で字のまま読めない値（`:` `#` を含む・引用符や空白で始まる）は `"` で囲む
fn quote(value: &str) -> String {
    let plain = !value.contains(':')
        && !value.contains(" #")
        && !value.starts_with(['"', '\'', ' ', '#', '-', '[', '{']);
    if plain {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

/// `key: 値` を置く（あれば同じ場所で置き換え、無ければ末尾に足す）/ None で外した
/// 本文を返す。他の行は原文のまま。外して空になれば front matter ごと消す。
/// **アプリから front matter を書くのは、使う人の明示の操作の結果だけ**
/// （ピン留め・Qiita への投稿。ADR-0063）
pub fn with_value(text: &str, key: &str, value: Option<&str>) -> String {
    let line = value.map(|value| format!("{key}: {}", quote(value)));
    let Some(end) = block_len(text) else {
        return match line {
            Some(line) => format!("---\n{line}\n---\n{text}"),
            None => text.to_string(),
        };
    };
    let mut lines: Vec<String> = Vec::new();
    let mut placed = false;
    for existing in text[..end]
        .lines()
        .skip(1)
        .take_while(|line| line.trim_end_matches([' ', '\t']) != "---")
    {
        if is_key_line(existing, key) {
            if let (Some(line), false) = (&line, placed) {
                lines.push(line.clone());
                placed = true;
            }
        } else {
            lines.push(existing.to_string());
        }
    }
    if let (Some(line), false) = (line, placed) {
        lines.push(line);
    }
    let body = &text[end..];
    if lines.is_empty() {
        body.to_string()
    } else {
        format!("---\n{}\n---\n{body}", lines.join("\n"))
    }
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_block_len_共有の見本と同じ答えを出す() {
        // fixtures/front-matter-cases.json は TS 側（editor/frontmatter.ts）と
        // 同じ見本。二重に持っている規則が食い違わないよう、両方がここを見る
        let raw = include_str!("../../fixtures/front-matter-cases.json");
        let found: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in found["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let want = case["bodyStart"].as_u64().map(|n| n as usize);
            assert_eq!(block_len(text), want, "見本: {text:?}");
        }
    }

    #[test]
    fn test_block_len_閉じた区切りだけを認める() {
        assert_eq!(block_len("---\na: 1\n---\n本文"), Some(13));
        assert_eq!(block_len("---\na: 1\n---"), Some(12)); // 末尾改行なし
        assert_eq!(block_len("---\na: 1\n"), None); // 閉じ無し = 本文
        assert_eq!(block_len("\n---\na: 1\n---\n"), None); // 1 行目でない
        assert_eq!(block_len("本文だけ"), None);
        assert_eq!(block_len("---じ\na: 1\n---\n"), None); // `---abc` は本文
    }

    #[test]
    fn test_pinned_立っているときだけtrue() {
        assert!(pinned("---\npinned: true\n---\n本文"));
        assert!(!pinned("---\npinned: false\n---\n本文"));
        assert!(!pinned("---\nid: x\n---\n本文"));
        assert!(!pinned("本文に pinned: true と書いても効かない"));
    }

    #[test]
    fn test_with_pinned_front_matterが無ければ作る() {
        assert_eq!(
            with_pinned("# 題\n", true),
            "---\npinned: true\n---\n# 題\n"
        );
        assert_eq!(with_pinned("# 題\n", false), "# 題\n");
    }

    #[test]
    fn test_with_pinned_他のメタデータの行は原文のまま残す() {
        // 再ダンプすると引用符やコメントが失われる。行単位で触る
        let doc = "---\nid: \"01A\" # 鍵\npinned: false\n---\n本文";
        assert_eq!(
            with_pinned(doc, true),
            "---\nid: \"01A\" # 鍵\npinned: true\n---\n本文"
        );
    }

    #[test]
    fn test_with_pinned_外して空になればfront_matterごと消す() {
        assert_eq!(with_pinned("---\npinned: true\n---\n本文", false), "本文");
        assert_eq!(
            with_pinned("---\nid: x\npinned: true\n---\n本文", false),
            "---\nid: x\n---\n本文"
        );
    }

    #[test]
    fn test_with_pinned_往復で元に戻る() {
        let doc = "# 題\n\n中身\n";
        assert_eq!(with_pinned(&with_pinned(doc, true), false), doc);
    }

    // ------------------------------------- 任意のキー（Qiita の記事 ID。TASKS 14-4）

    #[test]
    fn test_value_素の値も引用符の値も読む() {
        let doc = "---\nqiita: c686397e4a0f\nqiita-updated-at: \"2026-10-02T10:00:00+09:00\"\n---\n# 題\n";
        assert_eq!(value(doc, "qiita").as_deref(), Some("c686397e4a0f"));
        assert_eq!(
            value(doc, "qiita-updated-at").as_deref(),
            Some("2026-10-02T10:00:00+09:00")
        );
        assert_eq!(value(doc, "なし"), None);
        // 前方一致で取り違えない
        assert_eq!(value(doc, "qiita-updated"), None);
        assert_eq!(value("# 題\n\nqiita: 本文\n", "qiita"), None);
    }

    #[test]
    fn test_with_value_無ければ作り_あれば置き換え_他の行は残す() {
        let made = with_value("# 題\n", "qiita", Some("abc"));
        assert_eq!(made, "---\nqiita: abc\n---\n# 題\n");
        let doc = "---\npinned: true\nqiita: old\n---\n# 題\n";
        assert_eq!(
            with_value(doc, "qiita", Some("new")),
            "---\npinned: true\nqiita: new\n---\n# 題\n"
        );
    }

    #[test]
    fn test_with_value_コロンを含む値は引用符で囲む() {
        let doc = with_value(
            "# 題\n",
            "qiita-updated-at",
            Some("2026-10-02T10:00:00+09:00"),
        );
        assert_eq!(
            doc,
            "---\nqiita-updated-at: \"2026-10-02T10:00:00+09:00\"\n---\n# 題\n"
        );
        assert_eq!(
            value(&doc, "qiita-updated-at").as_deref(),
            Some("2026-10-02T10:00:00+09:00")
        );
    }

    #[test]
    fn test_with_value_None_で外し_空になればfront_matterごと消す() {
        let doc = "---\nqiita: abc\n---\n# 題\n";
        assert_eq!(with_value(doc, "qiita", None), "# 題\n");
        assert_eq!(with_value("# 題\n", "qiita", None), "# 題\n");
    }
}
