// 性能計測（spec §6.6）: 全文検索 < 200ms（5,000 ノートの vault）。
// 実行: make bench-search（= cargo run --release --bin bench）
//
// 一時フォルダに 5,000 ノートを生成し、索引の構築・再同期・検索を実測する。
// 基準と突き合わせた判定まで出す（CLAUDE.md: 検証していない性能を
// 「できました」と報告しない）。

use std::fs;
use std::time::Instant;

use oboegaki_lib::index_db::IndexDb;
use oboegaki_lib::vault::Vault;

const NOTES: usize = 5_000;
const SEARCH_BUDGET_MS: u128 = 200;

fn main() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    // --- vault 生成。日本語主体で、検索させる語を疎らに混ぜる
    let stopwatch = Instant::now();
    let filler = "日本語は分かち書きしないため、形態素解析なしの部分一致が要る。\
今日の会議では検索基盤の設計と索引の再構築について話し合った。\
望遠鏡の組み立てと観測記録は別のノートにまとめる。";
    for index in 0..NOTES {
        let folder = root.join(format!("フォルダ{:02}", index % 20));
        fs::create_dir_all(&folder).expect("mkdir");
        let rare = if index % 500 == 0 {
            "\n\n稀少語キラウェア火山の記録。\n"
        } else {
            ""
        };
        let body = format!(
            "# ノート{index}\n\n{}\n\n{filler}{rare}\n- 項目 A\n- 項目 B\n",
            filler.repeat(1 + index % 3),
        );
        fs::write(folder.join(format!("ノート{index}.md")), body).expect("write");
    }
    println!("生成: {NOTES} ノート in {:?}", stopwatch.elapsed());

    let vault = Vault::new(root);
    vault.ensure_layout().expect("layout");

    // --- 初回の索引構築（vault を最初に開くときのコスト）
    let mut db = IndexDb::open(&vault.managed_dir()).expect("open");
    let stopwatch = Instant::now();
    db.sync(&vault).expect("sync");
    println!("索引の初回構築: {:?}", stopwatch.elapsed());

    // --- 変更なしの再同期（vault_open のたびに払うコスト）
    let stopwatch = Instant::now();
    db.sync(&vault).expect("resync");
    println!("再同期（変更なし）: {:?}", stopwatch.elapsed());

    // --- 検索。trigram（3 文字以上）と LIKE フォールバック（2 文字）の両方
    let queries = [
        ("検索基盤", "trigram・多数ヒット"),
        ("キラウェア火山", "trigram・希少ヒット"),
        ("存在しない語です", "trigram・ヒットなし"),
        ("会議", "LIKE フォールバック"),
    ];
    let mut worst: u128 = 0;
    for (query, label) in queries {
        let _ = db.search(query).expect("warm"); // 初回はページキャッシュが冷えている
        let stopwatch = Instant::now();
        let hits = db.search(query).expect("search");
        let elapsed = stopwatch.elapsed().as_millis();
        worst = worst.max(elapsed);
        println!("検索「{query}」({label}): {elapsed}ms, {} 件", hits.len());
    }

    println!(
        "\n基準: 全文検索 < {SEARCH_BUDGET_MS}ms（{NOTES} ノート） → {}",
        if worst < SEARCH_BUDGET_MS {
            format!("合格（最悪 {worst}ms）")
        } else {
            format!("不合格（最悪 {worst}ms）")
        }
    );
    if worst >= SEARCH_BUDGET_MS {
        std::process::exit(1);
    }
}
