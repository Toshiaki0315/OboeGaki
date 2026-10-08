// 文字起こしから議事録を作る（TASKS 28-2 / ADR-0070 決定 3）。純 Rust で、LLM は呼び手が渡す。
//
// 長い録音は約 15 分ずつに区切り、区切りごとに要点を抜き出してから 1 つにまとめる（2 段）。
// 1 時間で 1.5 万トークン前後になり、1 回では読ませきれないため。区切りが 1 つなら 1 回で作る。
//
// **作り話を抑える。** 頼み方で「文字起こしに書かれていないことは書かない」と縛り、後処理で
// 崩れた書式を直す（スパイク #4 で gemma3 が `\[ ]` や `- [ ] なし` を書いた）。

/// 1 区切りの長さ（秒）。15 分
pub const CHUNK_SECONDS: f64 = 15.0 * 60.0;
/// 1 区切りの字数の上限。早口の録音でも窓（16K トークン）に収める（スパイク #4: 9,108 字で
/// 約 4,900 トークン）
pub const CHUNK_CHARS: usize = 8_000;

/// 議事録の節（ADR-0070「形」）。頼み方とまとめで同じものを使う
const SECTIONS: &str =
    "- 見出しは「## 要旨」「## 話されたこと」「## 決まったこと」「## やること」「## 用語」の順
- 「要旨」は 3 行以内。「話されたこと」は話の流れに沿って箇条書き（各項目の頭に [mm:ss] を付ける）
- 「決まったこと」「やること」は、無ければ「なし」とだけ書く。やることは `- [ ] ` で書く
- 文字起こしに書かれていないことは書かない。評価や感想も書かない
- 文字起こしには音声認識の誤り（同音の取り違え）がある。文脈から明らかなものだけ直してよい
- 題（# の見出し）は書かない";

/// 区切りの 1 つ
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// 最初の行の時刻（`mm:ss`）
    pub from: String,
    /// 最後の行の時刻
    pub to: String,
    /// `[mm:ss] 文` の行
    pub text: String,
}

/// 進み具合（何回目の頼みか）
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(tag = "kind", content = "at", rename_all = "camelCase")]
pub enum Stage {
    /// 区切り（何番目, 全部で）の要点を抜き出している
    Chunk(usize, usize),
    /// まとめている
    Merge,
    /// 1 回で作っている（区切りが 1 つ）
    Single,
}

/// `[mm:ss]` / `[h:mm:ss]` の行の時刻（秒）
pub fn seconds_of(line: &str) -> Option<f64> {
    stamp_of(line).and_then(|stamp| {
        let parts: Vec<f64> = stamp
            .split(':')
            .map(|part| part.parse().ok())
            .collect::<Option<_>>()?;
        match parts.as_slice() {
            [m, s] => Some(m * 60.0 + s),
            [h, m, s] => Some(h * 3600.0 + m * 60.0 + s),
            _ => None,
        }
    })
}

fn stamp_of(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('[')?;
    let end = rest.find(']')?;
    Some(&rest[..end])
}

/// 行を約 span 秒ずつ・max_chars 字までに区切る（時刻の無い行は前の区切りに付ける）
pub fn split(text: &str, span: f64, max_chars: usize) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut start = 0.0;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let at = seconds_of(line);
        let size = line.chars().count() + 1;
        let fresh = match (chunks.last(), at) {
            (None, _) => true,
            (Some(current), Some(at)) => {
                at - start >= span || current.text.chars().count() + size > max_chars
            }
            (Some(current), None) => current.text.chars().count() + size > max_chars,
        };
        if fresh {
            start = at.unwrap_or(start);
            let stamp = stamp_of(line).unwrap_or("").to_string();
            chunks.push(Chunk {
                from: stamp.clone(),
                to: stamp,
                text: String::new(),
            });
        }
        let current = chunks.last_mut().expect("直前に足した");
        if let Some(stamp) = stamp_of(line) {
            current.to = stamp.to_string();
        }
        current.text.push_str(line);
        current.text.push('\n');
    }
    chunks
}

fn single_prompt(text: &str) -> String {
    format!("次の文字起こしから、日本語の議事録を Markdown で作ってください。\n\n{SECTIONS}\n\n# 文字起こし\n\n{text}")
}

fn chunk_prompt(chunk: &Chunk, index: usize, total: usize) -> String {
    format!(
        "次は、長い録音を区切った一部（{index}/{total}、{from}〜{to}）の文字起こしです。\n\
         この部分で話されたことを、話の流れに沿って [mm:ss] 付きの箇条書きで挙げてください。\n\
         決まったこと・やることがあれば、それぞれ別に挙げてください（無ければ書かない）。\n\
         文字起こしに書かれていないことは書かない。評価や感想も書かない。\n\n# 文字起こし\n\n{text}",
        from = chunk.from,
        to = chunk.to,
        text = chunk.text,
    )
}

fn merge_prompt(notes: &[String]) -> String {
    let joined = notes
        .iter()
        .enumerate()
        .map(|(index, note)| format!("## 区切り {}\n\n{}", index + 1, note.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "次は、長い録音を区切って、区切りごとに抜き出した要点です。これを 1 つの日本語の議事録に\n\
         まとめてください（区切りの順は録音の順）。\n\n{SECTIONS}\n\n# 区切りごとの要点\n\n{joined}"
    )
}

/// 議事録を作る（進み具合は知らせない）
pub fn make(text: &str, ask: impl FnMut(&str) -> Result<String, String>) -> Result<String, String> {
    make_with(text, ask, |_| {})
}

/// 議事録を作る。頼むたびに on_stage で知らせる。どこかで失敗したらそこで止める
pub fn make_with(
    text: &str,
    mut ask: impl FnMut(&str) -> Result<String, String>,
    mut on_stage: impl FnMut(Stage),
) -> Result<String, String> {
    let chunks = split(text, CHUNK_SECONDS, CHUNK_CHARS);
    match chunks.len() {
        0 => Err("文字起こしが空です".into()),
        1 => {
            on_stage(Stage::Single);
            Ok(tidy(&ask(&single_prompt(&chunks[0].text))?))
        }
        total => {
            let mut notes = Vec::with_capacity(total);
            for (index, chunk) in chunks.iter().enumerate() {
                on_stage(Stage::Chunk(index + 1, total));
                notes.push(ask(&chunk_prompt(chunk, index + 1, total))?);
            }
            on_stage(Stage::Merge);
            Ok(tidy(&ask(&merge_prompt(&notes))?))
        }
    }
}

/// モデルの崩れを直す: 本文を包む ``` を外す・先頭の `# 題` を外す（題はノートが付ける）・
/// `\[ ]` を `[ ]` に・「なし」だけのチェックボックスを「なし」に
pub fn tidy(raw: &str) -> String {
    let mut lines: Vec<&str> = raw.trim().lines().collect();
    if lines
        .first()
        .is_some_and(|line| line.trim_start().starts_with("```"))
    {
        lines.remove(0);
        if lines.last().is_some_and(|line| line.trim() == "```") {
            lines.pop();
        }
    }
    if lines.first().is_some_and(|line| line.starts_with("# ")) {
        lines.remove(0);
        while lines.first().is_some_and(|line| line.trim().is_empty()) {
            lines.remove(0);
        }
    }
    let fixed: Vec<String> = lines
        .iter()
        .map(|line| {
            let unescaped = line.replace("\\[", "[").replace("\\]", "]");
            let bare = unescaped
                .trim()
                .trim_start_matches(['-', '*'])
                .trim_start()
                .trim_start_matches("[ ]")
                .trim();
            let is_box =
                unescaped.trim_start().starts_with(['-', '*']) && unescaped.contains("[ ]");
            if is_box && bare == "なし" {
                "なし".to_string()
            } else {
                unescaped
            }
        })
        .collect();
    let joined = fixed.join("\n");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    fn lines(stamps: &[(&str, &str)]) -> String {
        stamps
            .iter()
            .map(|(at, text)| format!("[{at}] {text}\n"))
            .collect()
    }

    #[test]
    fn test_時刻を読む() {
        assert_eq!(seconds_of("[01:23] 文"), Some(83.0));
        assert_eq!(seconds_of("[1:02:05] 文"), Some(3725.0));
        assert_eq!(seconds_of("時刻の無い行"), None);
    }

    #[test]
    fn test_15_分ずつに区切る() {
        let text = lines(&[
            ("00:00", "一"),
            ("10:00", "二"),
            ("15:00", "三"),
            ("29:59", "四"),
            ("30:00", "五"),
        ]);
        let chunks = split(&text, 15.0 * 60.0, 100_000);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].text, "[00:00] 一\n[10:00] 二\n");
        assert_eq!(
            (chunks[0].from.as_str(), chunks[0].to.as_str()),
            ("00:00", "10:00")
        );
        assert_eq!(chunks[1].text, "[15:00] 三\n[29:59] 四\n");
        assert_eq!(chunks[2].text, "[30:00] 五\n");
    }

    #[test]
    fn test_区切りが長すぎれば字数でも切る() {
        let text = lines(&[
            ("00:00", "あいうえお"),
            ("00:10", "かきくけこ"),
            ("00:20", "さしすせそ"),
        ]);
        // 1 区切りに 2 行（約 30 字）までしか入らない上限
        let chunks = split(&text, 15.0 * 60.0, 30);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[1].text, "[00:20] さしすせそ\n");
    }

    #[test]
    fn test_区切りが_1_つなら_1_回で議事録を頼む() {
        let text = lines(&[("00:00", "予算の話をした"), ("05:00", "来週までに見積もる")]);
        let mut asked = Vec::new();
        let minutes = make(&text, |prompt| {
            asked.push(prompt.to_string());
            Ok("## 要旨\n\n予算の話\n".to_string())
        })
        .unwrap();
        assert_eq!(asked.len(), 1);
        assert!(asked[0].contains("## 要旨"), "{}", asked[0]);
        assert!(asked[0].contains("[05:00] 来週までに見積もる"));
        assert!(asked[0].contains("書かれていないことは書かない"));
        assert_eq!(minutes, "## 要旨\n\n予算の話\n");
    }

    #[test]
    fn test_長ければ区切りごとに要点を抜き出してから_まとめる() {
        let text = lines(&[("00:00", "前半の話"), ("20:00", "後半の話")]);
        let mut asked = Vec::new();
        let mut stages = Vec::new();
        let minutes = make_with(
            &text,
            |prompt| {
                asked.push(prompt.to_string());
                Ok(format!("要点{}", asked.len()))
            },
            |stage| stages.push(stage),
        )
        .unwrap();
        assert_eq!(asked.len(), 3, "区切り 2 つ + まとめ 1 回");
        assert!(asked[0].contains("1/2") && asked[0].contains("前半の話"));
        assert!(asked[1].contains("2/2") && asked[1].contains("後半の話"));
        assert!(
            !asked[0].contains("後半の話"),
            "区切りには他の区切りを混ぜない"
        );
        // まとめには区切りの要点だけを渡す（全文は渡さない = 窓に収める）
        assert!(asked[2].contains("要点1") && asked[2].contains("要点2"));
        assert!(!asked[2].contains("前半の話"));
        assert_eq!(minutes, "要点3\n");
        assert_eq!(
            stages,
            vec![Stage::Chunk(1, 2), Stage::Chunk(2, 2), Stage::Merge]
        );
    }

    #[test]
    fn test_途中で失敗したら止める() {
        let text = lines(&[("00:00", "前半"), ("20:00", "後半")]);
        let mut calls = 0;
        let result = make(&text, |_| {
            calls += 1;
            Err("Ollama が止まった".to_string())
        });
        assert_eq!(result, Err("Ollama が止まった".to_string()));
        assert_eq!(calls, 1);
    }

    #[test]
    fn test_文字起こしが空なら頼まない() {
        let result = make("", |_| panic!("頼まない"));
        assert!(result.is_err());
    }

    #[test]
    fn test_後処理で崩れた書式を直す() {
        let raw = "```markdown\n# 議事録\n\n## やること\n\n- \\[ ] 見積もる\n- [ ] なし\n\n## 決まったこと\n\n* [ ] なし\n```\n";
        assert_eq!(
            tidy(raw),
            "## やること\n\n- [ ] 見積もる\nなし\n\n## 決まったこと\n\nなし\n"
        );
    }

    #[test]
    fn test_後処理は中身の_なし_を消さない() {
        // 「なし」だけの項目でなければ触らない
        assert_eq!(
            tidy("- [ ] なしにした件を確かめる\n"),
            "- [ ] なしにした件を確かめる\n"
        );
    }
}
