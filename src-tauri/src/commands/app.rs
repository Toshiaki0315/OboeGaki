// 保管フォルダを開く・索引の同期・起動時間・メニューの印・MCP の設定と手引き。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::history::history_root;
use super::{index_one, CmdResult, FlagGuard, WatchState, DEFAULT_TRASH_DAYS, VAULT_BUSY};
use crate::history;
use crate::index_db::IndexDb;
use crate::vault::Vault;
use crate::watcher;

/// vault を開く: 改名引き継ぎ + レイアウト作成 + 監視開始 + 走査。
#[tauri::command]
pub async fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    root: String,
    trash_days: Option<u64>,
) -> CmdResult<()> {
    let vault = Vault::new(&root);
    vault.ensure_layout()?;
    // 「何を渡さないか」を書く場所は、最初から在った方が気付ける（中身は説明
    // だけで、何も隠さない）。vault 本体は MCP を知らない（19-2 で層の逆転を解いた）
    crate::mcp::ensure_ignore_file(vault.root())?;
    // 同じ vault の二重起動を止める（H-1 層 2 / spec §6.1）。2 窓で開くと
    // watcher が互いの保存に反応し、競合ダイアログが行き来する。
    // **先に手放してから取る** — 同じ vault を開き直すとき、自分の持って
    // いるロックに自分でぶつかる
    {
        // 毒化していても回復する（どこかのパニックで vault が永久に開けなく
        // ならないように — レビュー 2026-09-04）
        let mut held = state
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *held = None;
        // MCP サーバの app_running はロックを取ってすぐ手放すので、その一瞬と
        // 重なると Busy に見える。別のウィンドウの Busy は続くので、少し待って
        // 数回だけ試し直す（レビュー 2026-09-24 / 21-3）
        let mut outcome = crate::vault_lock::acquire(&vault.managed_dir());
        for _ in 0..3 {
            if !matches!(outcome, crate::vault_lock::LockOutcome::Busy) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
            outcome = crate::vault_lock::acquire(&vault.managed_dir());
        }
        match outcome {
            crate::vault_lock::LockOutcome::Acquired(lock) => *held = Some(lock),
            crate::vault_lock::LockOutcome::Busy => {
                // 頭の印はフロントが「開けない」と区別するためのもの
                // （記憶している vault を忘れるかどうかが変わる）
                return Err(format!(
                    "{VAULT_BUSY}: この保管フォルダは既に別のウィンドウで開いています。そちらをお使いください。"
                ).into());
            }
            // 置けなかっただけ。開けない保管フォルダと同じ扱いにする
            // （守るものが無い。ここで断ると嘘になる）
            crate::vault_lock::LockOutcome::Unavailable => {
                eprintln!("二重起動のロックを置けなかった（このまま開く）")
            }
        }
    }
    // 同梱の雛形と、初回だけの使い方ノート（E-4）。どちらも付随機能なので
    // 失敗しても vault は開く
    if let Err(error) = vault.seed_templates() {
        eprintln!("雛形を置けなかった: {error}");
    }
    match vault.seed_manual() {
        Ok(Some(placed)) => state.suppressor.mark(&placed),
        Ok(None) => {}
        Err(error) => eprintln!("使い方のノートを置けなかった: {error}"),
    }
    // 監視と索引は付随機能なので、失敗しても vault は開く（ログだけ残す）
    match watcher::start(
        app.clone(),
        vault.root().to_path_buf(),
        state.suppressor.clone(),
    ) {
        Ok(active) => {
            *state
                .watcher
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(active)
        }
        Err(error) => eprintln!("外部変更の監視を開始できなかった: {error}"),
    }
    // 索引の全体同期と履歴の掃除は背景で行う（5,000 ノートで 2.2 秒 —
    // bench.md）。終わったら index-updated でフロントが一覧を引き直す
    {
        let root = root.clone();
        let app = app.clone();
        let days = trash_days.unwrap_or(DEFAULT_TRASH_DAYS);
        let gate = state.sync_gate.clone();
        std::thread::spawn(move || {
            use tauri::Emitter;
            let vault = Vault::new(&root);
            // 全走査は 1 本ずつ（sync_gate）。開いた直後にフォルダ改名や
            // 手動同期が重なると、古いスナップショットの「消えた」が
            // 新しい行を消す（レビュー 2026-09-04）
            let sync_outcome = {
                let _serialized = gate
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(&vault))
            };
            if let Err(error) = sync_outcome {
                eprintln!("索引の同期に失敗した（検索は古いままになる）: {error}");
            }
            history::prune(&history_root(&root), chrono::Local::now().naive_local());
            // クラッシュで残った一時ファイル（.名前.xxxxxx.tmp）も掃く（21-4）
            let swept = crate::autosave::sweep_temporaries(vault.root());
            if swept > 0 {
                eprintln!("一時ファイルの残骸を {swept} 個掃いた");
            }
            // 期限切れのゴミも一緒に掃除する（spec §7.6。日数は環境設定）
            if let Err(error) = vault.purge_trash(days) {
                eprintln!("ゴミ箱の掃除に失敗した: {error}");
            }
            let _ = app.emit("index-updated", ());
        });
    }
    // 戻り値の一覧はフロントが使っていない（note_list が索引から引く）。
    // ここで scan すると背景同期と合わせて**全走査を 2 回**払う
    //（レビュー 2026-09-04）
    Ok(())
}

/// vault にノートが 1 つも無いか（ディスクを見る。索引は見ない）。起動時に
/// 「無題」を作るかの判断に使う（要望 2026-09-10、lib/startup-note）
#[tauri::command]
pub fn vault_is_empty(root: String) -> bool {
    Vault::new(&root).is_empty()
}

/// プロセス開始から UI マウントまでの時間（spec §6.6: 起動 < 1.5 秒の実測）。
/// フロントが最初のマウントで呼ぶ。OBOEGAKI_BENCH_STARTUP=1 のときは
/// 値を印字してから終了する（make bench-startup 用）。
#[tauri::command]
pub fn startup_elapsed_ms() -> u64 {
    let elapsed = crate::started().elapsed().as_millis() as u64;
    if std::env::var("OBOEGAKI_BENCH_STARTUP").is_ok() {
        println!("起動 → UI マウント: {elapsed}ms（基準: < 1500ms）");
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(300));
            std::process::exit(0);
        });
    }
    elapsed
}

/// 使い方のノートを今の内容で置き直す（ヘルプメニュー）。
/// `.mcp-ignore` に書いてある道の一覧（画面の印に使う）
#[tauri::command]
pub fn mcp_hidden(root: String) -> crate::mcp::Hidden {
    crate::mcp::hidden_list(std::path::Path::new(&root))
}

/// 「Claude に渡さない」の付け外し（ピン留めと同じ手触り）。
/// 絶対パスでも相対でも受ける（ノートは絶対、フォルダは相対で来る）。
/// 付け外したあとの一覧を返す — 画面が聞き直さなくて済む
#[tauri::command]
pub fn mcp_set_hidden(root: String, path: String, hidden: bool) -> CmdResult<crate::mcp::Hidden> {
    let root_path = std::path::Path::new(&root);
    let relative = crate::mcp::hidden_relative(root_path, &path)?;
    crate::mcp::set_hidden(root_path, &relative, hidden)?;
    Ok(crate::mcp::hidden_list(root_path))
}

/// メニューの印を今の状態に合わせる（要望 2026-09-13）。
///
/// **決めるのは画面側**（T2: 状態は画面が持つ）。ここは言われたとおりに
/// 付け外しするだけ。知らない id は黙って飛ばす
#[tauri::command]
pub fn menu_checks(
    checks: tauri::State<'_, crate::MenuChecks>,
    state: std::collections::HashMap<String, bool>,
) {
    checks.apply(&state);
}

/// Claude Desktop などに貼る MCP の設定（10-6）。**パスを手で打たせない** —
/// 束ねた `.app` の中の場所は人が知らない。本体の隣に居る前提で組み立てる
#[tauri::command]
pub fn mcp_config(root: String) -> CmdResult<String> {
    let exe = std::env::current_exe()?;
    let binary = crate::mcp::binary_next_to(&exe);
    Ok(crate::mcp::config_snippet(
        &binary,
        std::path::Path::new(&root),
    ))
}

/// MCP の手引きのノートを置く（10-6 の続き。ヘルプメニューから）
#[tauri::command]
pub fn mcp_manual_place(state: tauri::State<'_, WatchState>, root: String) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let placed = vault.place_mcp_manual()?;
    state.suppressor.mark(&placed);
    Ok(placed.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn manual_place(state: tauri::State<'_, WatchState>, root: String) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let placed = vault.place_manual()?;
    state.suppressor.mark(&placed);
    index_one(&vault, &placed);
    Ok(placed.to_string_lossy().into_owned())
}

/// ファイルと索引を手で合わせ直す（M-6）。始めたら true、走査中なら false。
///
/// 監視（watcher）は動いている間しか効かず、閉じている間の操作や
/// ネットワーク越しの変更は取りこぼす。**取りこぼしたことは画面から
/// 分からない**ので、押せば必ず合う道を用意する。
///
/// `full` は索引を捨てて全部読み直す（索引そのものが疑わしいとき）。
/// 終わったら `index-synced` に結果を載せて知らせる。
#[tauri::command]
pub fn index_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    root: String,
    full: bool,
) -> CmdResult<bool> {
    use std::sync::atomic::Ordering;
    if state.syncing.swap(true, Ordering::SeqCst) {
        return Ok(false); // 走査中。**押しても無反応に見せない**のは呼ぶ側
    }
    let syncing = state.syncing.clone();
    let gate = state.sync_gate.clone();
    std::thread::spawn(move || {
        use tauri::Emitter;
        let _flag = FlagGuard(syncing); // パニックしても必ず降ろす
        let vault = Vault::new(&root);
        let outcome = {
            let _serialized = gate
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
                if full {
                    db.rebuild(&vault)
                } else {
                    db.sync(&vault)
                }
            })
        };
        match outcome {
            Ok(result) => {
                let _ = app.emit("index-synced", (full, result));
            }
            Err(error) => {
                eprintln!("索引の同期に失敗した: {error}");
                let _ = app.emit("index-sync-failed", error.to_string());
            }
        }
    });
    Ok(true)
}

/// 既定の保管フォルダ（ADR-0032 決定 3）。パスを保存していない人が
/// 最初に開く場所。**まだ無ければ作るのは開くときの仕事**（`vault_open`）。
#[tauri::command]
pub fn default_vault(app: tauri::AppHandle) -> CmdResult<String> {
    use tauri::Manager;
    let documents = app.path().document_dir()?;
    Ok(crate::vault::default_vault_in(&documents)
        .to_string_lossy()
        .into_owned())
}
