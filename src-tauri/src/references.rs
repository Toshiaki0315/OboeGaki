// 本文が指している添付の名前を集める（E-5）。参照実装 core/references.py の移植。
//
// 未使用の添付を片づけるための判断材料。**取りこぼすと画像が消える**ので、
// ここだけは他の走査と考え方が違う。
//
// - **書き方を数え上げない。** `![](…)` も `[…](…)` も生の `<img src>` も
//   参照型リンクも、すべて `attachments/名前` という並びを含む。その並びを
//   拾えば、書き方を列挙しなくても届く（列挙は必ず漏れる）
// - **コードブロックの中も数える。** タグやリンクの走査と違い、ここで
//   答えるのは「本当に使っているか」ではなく「**消しても安全か**」。
//   迷ったら残すのが正しい

use std::collections::HashSet;

const PREFIX: &str = "attachments/";
/// 記法の閉じと空白、クエリ・アンカーで切る。
const STOPPERS: [char; 10] = [')', '"', '\'', '>', ']', '<', '?', '#', ' ', '\t'];

/// 本文に出てくる添付のファイル名。
///
/// パーセント符号化は戻す（`%E5%9B%B3.png` → `図.png`）。書かれたパスに
/// フォルダが付いていても**末尾の名前だけ**を見る（添付は `attachments/`
/// 直下にあり、名前で一意に決まる）。
pub fn attachment_names(text: &str) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut rest = text;
    while let Some(at) = rest.find(PREFIX) {
        let tail = &rest[at + PREFIX.len()..];
        let end = tail
            .find(|c: char| STOPPERS.contains(&c) || c == '\n' || c == '\r')
            .unwrap_or(tail.len());
        let name = percent_decode(&tail[..end]);
        let name = name.rsplit('/').next().unwrap_or_default().to_string();
        if !name.is_empty() && name != "." && name != ".." {
            found.insert(name);
        }
        rest = &tail[end..];
    }
    found
}

/// `%E5%9B%B3` のような並びを戻す。**戻せないものはそのまま返す**
/// （壊れた符号化のせいで参照を見失うより、余分に残すほうが安全）。
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        // **バイトのまま**読む。&str をバイト添字で切ると `%あ` のような
        // 並びで文字境界パニックになる（レビュー 2026-09-04 で実証）
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = [bytes[index + 1], bytes[index + 2]];
            if hex.iter().all(u8::is_ascii_hexdigit) {
                let digit = |b: u8| (b as char).to_digit(16).expect("hexdigit 検査済み") as u8;
                out.push(digit(hex[0]) * 16 + digit(hex[1]));
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(text: &str) -> Vec<String> {
        let mut found: Vec<String> = attachment_names(text).into_iter().collect();
        found.sort();
        found
    }

    #[test]
    fn test_percent_の直後にマルチバイト文字が来ても落ちない() {
        // レビュー 2026-09-04: バイト添字で &str を切っていて、
        // `%あ` で char boundary パニックしていた（実証済み）
        assert_eq!(percent_decode("%あ.png"), "%あ.png");
        assert_eq!(percent_decode("図%E5%9B%B3と%あ"), "図図と%あ");
        assert_eq!(percent_decode("%e3%81%82"), "あ"); // 小文字の hex も可
        assert_eq!(percent_decode("%"), "%");
        assert_eq!(percent_decode("%2"), "%2");
    }

    #[test]
    fn test_書き方を問わず拾う() {
        let text = "![](attachments/図.png)\n\
                    [資料](attachments/資料.pdf)\n\
                    <img src=\"attachments/写真.jpg\">\n\
                    [ref]: attachments/参照.png\n";
        assert_eq!(
            names(text),
            vec!["写真.jpg", "参照.png", "図.png", "資料.pdf"]
        );
    }

    #[test]
    fn test_パーセント符号化を戻す() {
        assert_eq!(names("![](attachments/%E5%9B%B3.png)"), vec!["図.png"]);
    }

    #[test]
    fn test_末尾の名前だけを見る() {
        assert_eq!(names("![](attachments/古い/図.png)"), vec!["図.png"]);
    }

    #[test]
    fn test_クエリやアンカーで切る() {
        assert_eq!(names("![](attachments/図.png?v=2)"), vec!["図.png"]);
        assert_eq!(names("![](attachments/図.png#top)"), vec!["図.png"]);
    }

    #[test]
    fn test_コードの中も数える() {
        // ここで答えるのは「消しても安全か」。迷ったら残すのが正しい
        let text = "```md\n![](attachments/例.png)\n```\n";
        assert_eq!(names(text), vec!["例.png"]);
    }

    #[test]
    fn test_指していなければ空() {
        assert!(names("本文だけ").is_empty());
        assert!(names("attachments/").is_empty());
    }

    #[test]
    fn test_壊れた符号化はそのまま残す() {
        // 参照を見失うより、余分に残すほうが安全
        assert_eq!(names("![](attachments/%ZZ.png)"), vec!["%ZZ.png"]);
    }
}
