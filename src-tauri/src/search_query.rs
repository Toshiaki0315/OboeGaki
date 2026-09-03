// 検索の問い合わせを読み取る（参照実装 core/searchquery.py の移植）。
//
// 全文一致だけではタグで絞れなかった。索引にはタグが入っているので、
// `#仕事 予算` のように**本文と同じ書き方**で絞れるようにする。
//
// **入力欄は増やさない。** 書き方が本文と揃っているほうが覚えることが少ない。
//
// ここは SQL に触れない。読み取るだけで、どう探すかは index_db の仕事。

use chrono::NaiveDate;

#[derive(Debug, Default, PartialEq)]
pub struct SearchQuery {
    /// 本文から探す言葉。タグだけを書いたときは空。
    pub text: String,
    /// 絞り込みのタグ。**全部満たすものだけ**を返す（AND）。
    pub tags: Vec<String>,
    /// この日以降に更新したものだけ。**その日を含む。**
    pub after: Option<NaiveDate>,
    /// この日以前に更新したものだけ。**その日を含む。**
    pub before: Option<NaiveDate>,
    /// 日付として読めなかった `after:` / `before:`。
    ///
    /// **探すのはやめない**（言葉として残す）が、書き方が違うことは
    /// 呼び出し側から知らせられるように覚えておく。0 件になった理由が
    /// 画面から読めないと、打ち間違いに気づけない。
    pub unreadable_dates: Vec<String>,
}

impl SearchQuery {
    /// 絞り込みだけで、本文の言葉が無いか。
    pub fn filter_only(&self) -> bool {
        self.text.is_empty() && self.has_filters()
    }

    pub fn has_filters(&self) -> bool {
        !self.tags.is_empty() || self.after.is_some() || self.before.is_some()
    }
}

/// 打たれた文字列を「タグ」「期間」「言葉」に分ける。
///
/// **語では分けない。** 残りはそのまま全文検索へ渡す（`来週の予算` は打った
/// 通りの並びで探す）。**AND で絞る** — OR だと、絞ったのに件数が増えて驚く。
pub fn parse(query: &str) -> SearchQuery {
    let mut found = SearchQuery::default();
    let mut rest: Vec<String> = Vec::new();

    for word in query.split_whitespace() {
        if let Some(name) = tag_word(word) {
            // 索引は正規化済みで持っている。揃えないと `#TODO` が
            // サイドバーでは引けるのに検索だけ 0 件になる
            if !name.is_empty() && !found.tags.contains(&name) {
                found.tags.push(name);
            }
            continue;
        }
        if let Some((edge, value)) = date_word(word) {
            match crate::template::strict_date(value) {
                Some(day) => {
                    if edge == "after" {
                        found.after = Some(day);
                    } else {
                        found.before = Some(day);
                    }
                }
                // **黙って絞らない。** 打ち間違い（`after:きのう`）を絞り込みと
                // 見なすと、0 件になった理由が画面から分からない
                None => {
                    found.unreadable_dates.push(word.to_string());
                    rest.push(word.to_string());
                }
            }
            continue;
        }
        rest.push(word.to_string());
    }
    // 置換の跡の空白は畳む。`予算 #仕事 会議` を素直に置換すると
    // `予算   会議` になり、FTS も LIKE もその空白を文字として要求して
    // 黙って 0 件になる（参照実装のコードレビュー指摘）
    found.text = rest.join(" ");
    found
}

/// その語がタグ条件（`#仕事`）なら正規化した名前。違えば None。
/// 判定は本文と**同じ規則**（tags.rs）を使う。
fn tag_word(word: &str) -> Option<String> {
    let name = word.strip_prefix('#')?;
    if name.is_empty() || name.contains('#') {
        return None;
    }
    Some(crate::tags::normalize(name))
}

/// `after:2026-08-01` を（端, 値）に分ける。違えば None。
fn date_word(word: &str) -> Option<(&'static str, &str)> {
    for edge in ["after", "before"] {
        if let Some(value) = strip_prefix_ignore_case(word, &format!("{edge}:")) {
            return Some((edge, value));
        }
    }
    None
}

fn strip_prefix_ignore_case<'a>(word: &'a str, prefix: &str) -> Option<&'a str> {
    // 境界を確かめてから切る（`予算の…` のような多バイト文字で
    // split_at は落ちる）
    let head = word.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &word[prefix.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn test_parse_タグと言葉に分ける() {
        let found = parse("#仕事 来週の予算");
        assert_eq!(found.text, "来週の予算");
        assert_eq!(found.tags, vec!["仕事"]);
    }

    #[test]
    fn test_parse_タグは正規化して重複を除く() {
        let found = parse("#TODO #todo #Work/会議");
        assert_eq!(found.tags, vec!["todo", "work/会議"]);
        assert_eq!(found.text, "");
        assert!(found.filter_only());
    }

    #[test]
    fn test_parse_跡の空白は畳む() {
        // `予算   会議` になると FTS も LIKE も空白を文字として要求する
        let found = parse("予算 #仕事 会議");
        assert_eq!(found.text, "予算 会議");
    }

    #[test]
    fn test_parse_期間を読む() {
        let found = parse("予算 after:2026-08-01 before:2026-08-31");
        assert_eq!(found.text, "予算");
        assert_eq!(found.after, Some(day(2026, 8, 1)));
        assert_eq!(found.before, Some(day(2026, 8, 31)));
        assert!(found.unreadable_dates.is_empty());
    }

    #[test]
    fn test_parse_読めない日付は言葉として残す() {
        let found = parse("after:きのう 予算");
        assert_eq!(found.after, None);
        // 探すのはやめない。ただし書き方が違うことは知らせられるようにする
        assert_eq!(found.text, "after:きのう 予算");
        assert_eq!(found.unreadable_dates, vec!["after:きのう"]);
    }

    #[test]
    fn test_parse_ゼロ詰めでない日付は読まない() {
        // 書き方が 2 通りあると説明が増える（アプリはゼロ詰めしか作らない）
        let found = parse("after:2026-8-1");
        assert_eq!(found.after, None);
        assert_eq!(found.unreadable_dates, vec!["after:2026-8-1"]);
    }

    #[test]
    fn test_parse_タグでも日付でもない語はそのまま() {
        let found = parse("#");
        assert_eq!(found.text, "#");
        assert!(found.tags.is_empty());
        assert!(!found.has_filters());
    }

    #[test]
    fn test_parse_空なら何も無い() {
        assert_eq!(parse("   "), SearchQuery::default());
    }
}
