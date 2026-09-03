// 関連するノートを並べる（TASKS 4-10 / L-3）。
//
// **LLM に選ばせない。** 関係の根拠は既に索引の中にある（同じタグ・
// `[[…]]` の指し合い・題名の語）。モデルに選ばせると**なぜ関係するのか
// 確かめられず**、待たされ、Ollama を入れていない人には何も出ない。
// 索引から引けば即座に出て、**理由も一緒に出せる**。
//
// ここは並べ方だけ。索引を引くのは呼ぶ側（参照実装 core/related.py と同じ分け方）。

/// `[[…]]` で指している / 指されている。**書いた人が手で結んだ**関係なので
/// いちばん強い。
pub const LINK: i32 = 3;
/// 同じタグ。これも手で付けたもの。
pub const SHARED_TAG: i32 = 2;
/// 題名の語が本文に出てくる。**偶然もある**ので弱く見る。
pub const TEXT: i32 = 1;
/// 画面に入らない数を出さない。
pub const DEFAULT_LIMIT: usize = 8;

/// 「このノートが関係する」1 つの根拠。
#[derive(Debug, Clone, PartialEq)]
pub struct Signal {
    /// ノートを見分ける印（vault からの相対パス）。
    pub key: String,
    /// **そのまま画面に出す。** 出た理由が読めないと確かめようがない。
    pub reason: String,
    pub weight: i32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Related {
    pub key: String,
    pub reasons: Vec<String>,
    pub score: i32,
}

/// 信号を束ねて強い順に並べる。**自分は外す。**
///
/// 同じ強さなら渡された順のまま（索引は更新順で返すので、新しいものが
/// 上に来る）。
pub fn rank(signals: &[Signal], exclude: &str, limit: usize) -> Vec<Related> {
    let mut order: Vec<String> = Vec::new();
    let mut found: std::collections::HashMap<String, Related> = std::collections::HashMap::new();
    for signal in signals {
        if signal.key == exclude {
            continue;
        }
        let entry = found.entry(signal.key.clone()).or_insert_with(|| {
            order.push(signal.key.clone());
            Related {
                key: signal.key.clone(),
                reasons: Vec::new(),
                score: 0,
            }
        });
        entry.score += signal.weight;
        // 同じ理由は 1 度だけ（「同じタグ #仕事」が 3 回並ばない）
        if !entry.reasons.contains(&signal.reason) {
            entry.reasons.push(signal.reason.clone());
        }
    }
    // **安定に並べる**（同点は渡された順）
    order.sort_by_key(|key| -found[key].score);
    order
        .into_iter()
        .take(limit)
        .map(|key| found[&key].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(key: &str, reason: &str, weight: i32) -> Signal {
        Signal {
            key: key.to_string(),
            reason: reason.to_string(),
            weight,
        }
    }

    #[test]
    fn test_rank_強い順に並べて理由を束ねる() {
        let signals = vec![
            signal("a.md", "同じタグ #仕事", SHARED_TAG),
            signal("b.md", "このノートを指している", LINK),
            signal("a.md", "題名が本文に出てくる", TEXT),
        ];

        let found = rank(&signals, "self.md", DEFAULT_LIMIT);

        assert_eq!(found[0].key, "a.md"); // 2 + 1 = 3
        assert_eq!(
            found[0].reasons,
            vec!["同じタグ #仕事", "題名が本文に出てくる"]
        );
        assert_eq!(found[1].key, "b.md");
    }

    #[test]
    fn test_rank_自分は外す() {
        let signals = vec![signal("self.md", "同じタグ #仕事", SHARED_TAG)];
        assert!(rank(&signals, "self.md", DEFAULT_LIMIT).is_empty());
    }

    #[test]
    fn test_rank_同じ理由は1度だけ() {
        // 「同じタグ #仕事」が 3 回並ばない
        let signals = vec![
            signal("a.md", "同じタグ #仕事", SHARED_TAG),
            signal("a.md", "同じタグ #仕事", SHARED_TAG),
        ];
        let found = rank(&signals, "", DEFAULT_LIMIT);
        assert_eq!(found[0].reasons.len(), 1);
        assert_eq!(found[0].score, SHARED_TAG * 2); // 重さは足す
    }

    #[test]
    fn test_rank_同点は渡された順() {
        // 索引は更新順で返すので、新しいものが上に来る
        let signals = vec![
            signal("新しい.md", "同じタグ #a", SHARED_TAG),
            signal("古い.md", "同じタグ #a", SHARED_TAG),
        ];
        let found = rank(&signals, "", DEFAULT_LIMIT);
        assert_eq!(found[0].key, "新しい.md");
    }

    #[test]
    fn test_rank_画面に入らない数は出さない() {
        let signals: Vec<Signal> = (0..20)
            .map(|index| signal(&format!("{index}.md"), "同じタグ #a", SHARED_TAG))
            .collect();
        assert_eq!(rank(&signals, "", DEFAULT_LIMIT).len(), DEFAULT_LIMIT);
    }

    #[test]
    fn test_手で結んだ関係がいちばん強い() {
        // 重みの並びは判断そのもの（リンク > タグ > 言及）
        assert!(LINK > SHARED_TAG && SHARED_TAG > TEXT);
    }
}
