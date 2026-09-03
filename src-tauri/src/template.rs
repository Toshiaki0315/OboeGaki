// 雛形の印を埋める（E-4。参照実装 core/template.py の移植）。
//
// 議事録や日報の雛形から新しいノートを作るとき、日付や題名を作った瞬間に
// 埋める。雛形は vault の `templates/` に置いた**ただの `.md`** で、独自
// 形式ではない（T1 と同じ考え方。真実はファイル側にある）。
//
// 差し込めるのは 4 つだけ。増やすほど「覚えないと使えない道具」になる。
//
// | 印 | 中身 |
// |---|---|
// | `{{date}}` | 日付。`{{date:%Y年%m月%d日}}` で書式を変えられる |
// | `{{time}}` | 時刻。同じく書式を指定できる |
// | `{{title}}` | 付ける題名 |
// | `{{cursor}}` | 作った直後にキャレットを置く場所（印は残らない） |
//
// **知らない印は残す。** 消すと、書いた人には理由の分からない欠落になる。

use chrono::{DateTime, Local};

pub const DATE_FORMAT: &str = "%Y-%m-%d";
pub const TIME_FORMAT: &str = "%H:%M";
const CURSOR: &str = "cursor";

#[derive(Debug, PartialEq)]
pub struct Expanded {
    pub text: String,
    /// `{{cursor}}` があった位置。**UTF-16 コード単位**で数える
    /// （CM6 のオフセットがそれなので、フロントがそのまま使える）。
    pub cursor: Option<usize>,
}

/// 雛形の印を埋める。
///
/// 日時は**引数で受け取る**。中で `Local::now()` を呼ぶと、テストが
/// 実行した瞬間に依存して再現しなくなる。
pub fn expand(text: &str, now: &DateTime<Local>, title: &str) -> Expanded {
    let mut out = String::with_capacity(text.len());
    let mut cursor: Option<usize> = None;
    let mut units = 0usize; // out の長さ（UTF-16 コード単位）
    let bytes = text.as_bytes();
    let mut index = 0;

    while index < text.len() {
        let Some(open) = text[index..].find("{{").map(|at| index + at) else {
            break;
        };
        let Some(close) = text[open + 2..].find("}}").map(|at| open + 2 + at) else {
            break; // 閉じが無い。残りは素の本文
        };
        let inside = &text[open + 2..close];
        // 書式に `}` は書けない（閉じ括弧と区別が付かない）
        let Some((name, format)) = split_placeholder(inside) else {
            // 印の形をしていない。`{{` の分だけ進めて先を探す
            out.push_str(&text[index..open + 2]);
            units += utf16_len(&text[index..open + 2]);
            index = open + 2;
            continue;
        };
        let Some(value) = value_of(&name, format.as_deref(), now, title) else {
            // 知らない印。そのまま本文として残す
            out.push_str(&text[index..close + 2]);
            units += utf16_len(&text[index..close + 2]);
            index = close + 2;
            continue;
        };
        let head = &text[index..open];
        out.push_str(head);
        units += utf16_len(head);
        if name == CURSOR {
            // 2 つ以上あっても最初のところ。印はどれも残さない
            cursor.get_or_insert(units);
        } else {
            out.push_str(&value);
            units += utf16_len(&value);
        }
        index = close + 2;
        debug_assert!(index <= bytes.len());
    }
    out.push_str(&text[index..]);
    Expanded { text: out, cursor }
}

/// `名前` と `名前:書式` に分ける。名前が印の形（英数字と `_`）でなければ None。
fn split_placeholder(inside: &str) -> Option<(String, Option<String>)> {
    let (raw_name, format) = match inside.split_once(':') {
        Some((name, format)) => (name, Some(format.to_string())),
        None => (inside, None),
    };
    let name = raw_name.trim();
    if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    Some((name.to_string(), format))
}

/// 印の中身。知らない名前なら None（＝そのまま残す）。
fn value_of(
    name: &str,
    format: Option<&str>,
    now: &DateTime<Local>,
    title: &str,
) -> Option<String> {
    match name {
        CURSOR => Some(String::new()), // 中身は空。位置だけを expand が覚える
        "date" => strftime(now, format.unwrap_or(DATE_FORMAT)),
        "time" => strftime(now, format.unwrap_or(TIME_FORMAT)),
        "title" => Some(title.to_string()),
        _ => None,
    }
}

/// 書式を当てる。読めない書式は None（＝印をそのまま残す。勝手に
/// 別の形の日付を入れるより、書いた人が間違いに気づける）。
fn strftime(now: &DateTime<Local>, format: &str) -> Option<String> {
    let items = chrono::format::StrftimeItems::new(format).parse().ok()?;
    Some(now.format_with_items(items.iter()).to_string())
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `2026-08-14` を日付として読む。その形でなければ None。
///
/// **書き戻して一致するものだけ**を認める。ゼロ詰めの無い `2026-8-14` も
/// 読める書き方にすると説明が増えるし、アプリはゼロ詰めしか作らない。
/// 検索の `after:` / `before:`（search_query）と日次ノートの判定が
/// **同じ規則を使う**ための 1 本。別々に書くと片方だけ緩めたときにずれる。
pub fn strict_date(value: &str) -> Option<chrono::NaiveDate> {
    let day = chrono::NaiveDate::parse_from_str(value, DATE_FORMAT).ok()?;
    (day.format(DATE_FORMAT).to_string() == value).then_some(day)
}

/// 日次ノートの題名（E-4）。`{{date}}` と同じ書式にする — ファイル名にも
/// 一覧にも出るので、揃っていないと日付順に見えない。
pub fn daily_title(now: &DateTime<Local>) -> String {
    now.format(DATE_FORMAT).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn test_expand_日付と時刻と題名を埋める() {
        let now = at(2026, 9, 3, 14, 5);
        let found = expand("# {{title}}\n\n{{date}} {{time}}\n", &now, "議事録");
        assert_eq!(found.text, "# 議事録\n\n2026-09-03 14:05\n");
        assert_eq!(found.cursor, None);
    }

    #[test]
    fn test_expand_書式を指定できる() {
        let now = at(2026, 9, 3, 14, 5);
        let found = expand("{{date:%Y年%m月%d日}} {{time:%H時}}", &now, "");
        assert_eq!(found.text, "2026年09月03日 14時");
    }

    #[test]
    fn test_expand_cursorは印を残さず位置を返す() {
        let now = at(2026, 9, 3, 14, 5);
        let found = expand("## やったこと\n\n- {{cursor}}\n", &now, "");
        assert_eq!(found.text, "## やったこと\n\n- \n");
        assert_eq!(
            found.cursor,
            Some("## やったこと\n\n- ".encode_utf16().count())
        );
    }

    #[test]
    fn test_expand_cursorは最初のものだけ_印はどれも残さない() {
        let now = at(2026, 9, 3, 14, 5);
        let found = expand("a{{cursor}}b{{cursor}}c", &now, "");
        assert_eq!(found.text, "abc");
        assert_eq!(found.cursor, Some(1));
    }

    #[test]
    fn test_expand_知らない印は残す() {
        let now = at(2026, 9, 3, 14, 5);
        // 消すと、書いた人には理由の分からない欠落になる
        let found = expand("{{author}} と {{ date }} と {{}}", &now, "");
        assert_eq!(found.text, "{{author}} と 2026-09-03 と {{}}");
    }

    #[test]
    fn test_expand_閉じていない印は本文のまま() {
        let now = at(2026, 9, 3, 14, 5);
        assert_eq!(expand("{{date", &now, "").text, "{{date");
        assert_eq!(expand("式は {{ です", &now, "").text, "式は {{ です");
    }

    #[test]
    fn test_expand_読めない書式は印を残す() {
        let now = at(2026, 9, 3, 14, 5);
        assert_eq!(expand("{{date:%}}", &now, "").text, "{{date:%}}");
    }

    #[test]
    fn test_expand_cursorの位置はutf16で数える() {
        let now = at(2026, 9, 3, 14, 5);
        // 絵文字（BMP 外）はサロゲートペアで 2 単位。CM6 の数え方に合わせる
        let found = expand("😀{{cursor}}", &now, "");
        assert_eq!(found.cursor, Some(2));
    }

    #[test]
    fn test_strict_date_書き戻して一致するものだけ() {
        use chrono::NaiveDate;
        assert_eq!(
            strict_date("2026-08-14"),
            NaiveDate::from_ymd_opt(2026, 8, 14)
        );
        assert_eq!(strict_date("2026-8-14"), None); // ゼロ詰めでない
        assert_eq!(strict_date("2026-13-01"), None);
        assert_eq!(strict_date("きのう"), None);
    }

    #[test]
    fn test_daily_title_ゼロ詰めの日付() {
        assert_eq!(daily_title(&at(2026, 9, 3, 0, 0)), "2026-09-03");
    }
}
