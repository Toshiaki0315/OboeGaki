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

#[cfg(test)]
mod tests {
    use super::*;

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
}
