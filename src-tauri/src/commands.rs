// Tauri commands。フロントとの境界の薄い層で、ロジックは持たない（T3）。
// パスを受け取る command は必ず vault::contains で封じ込めを確認する。
// ファイルを動かす command は Suppressor に記録し、自分の書き込みが
// 「外部変更」としてフロントへ跳ね返らないようにする（spec §7.5）。

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::autosave;
use crate::history;
use crate::index_db::{IndexDb, SearchHit};
use crate::vault::{contains, Vault};
use crate::watcher::{self, Suppressor};

/// ノートの履歴の鍵。id を持たないので vault からの相対パスで作る。
fn history_key(root: &str, path: &Path) -> String {
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned();
    format!("path:{relative}")
}

fn history_root(root: &str) -> std::path::PathBuf {
    history::store_root(&Vault::new(root).managed_dir())
}

/// vault ごとに 1 本の watcher と、自書き込みの無視リスト。
/// 新しい vault を開いたら watcher を置き換える（drop で旧監視は止まる）。
pub struct WatchState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    suppressor: Arc<Suppressor>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            suppressor: Arc::new(Suppressor::default()),
        }
    }
}

fn guarded(root: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let candidate = Path::new(path).to_path_buf();
    if contains(Path::new(root), &candidate) {
        Ok(candidate)
    } else {
        Err(format!("vault の外を指しています: {path}"))
    }
}

/// vault を開く: 改名引き継ぎ + レイアウト作成 + 監視開始 + 走査。
#[tauri::command]
pub fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    root: String,
) -> Result<Vec<String>, String> {
    let vault = Vault::new(&root);
    vault.ensure_layout().map_err(|e| e.to_string())?;
    // 監視と索引は付随機能なので、失敗しても vault は開く（ログだけ残す）
    match watcher::start(
        app.clone(),
        vault.root().to_path_buf(),
        state.suppressor.clone(),
    ) {
        Ok(active) => *state.watcher.lock().expect("watcher lock") = Some(active),
        Err(error) => eprintln!("外部変更の監視を開始できなかった: {error}"),
    }
    // 索引の全体同期と履歴の掃除は背景で行う（5,000 ノートで 2.2 秒 —
    // bench.md）。終わったら index-updated でフロントが一覧を引き直す
    {
        let root = root.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            use tauri::Emitter;
            let vault = Vault::new(&root);
            if let Err(error) =
                IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(&vault))
            {
                eprintln!("索引の同期に失敗した（検索は古いままになる）: {error}");
            }
            history::prune(&history_root(&root), chrono::Local::now().naive_local());
            // 期限切れのゴミも一緒に掃除する（spec §7.6、30 日）
            if let Err(error) = vault.purge_trash(30) {
                eprintln!("ゴミ箱の掃除に失敗した: {error}");
            }
            let _ = app.emit("index-updated", ());
        });
    }
    Ok(vault
        .scan()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn note_read(root: String, path: String) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_write(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    autosave::save_atomic(&path, &text).map_err(|e| e.to_string())?;
    // 索引の後追い。失敗しても保存は成立している（次の sync が取り直す）
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    // 版の履歴（ADR-0023）。60 分間引き。失敗しても保存は成立している
    if let Err(error) = history::keep(
        &history_root(&root),
        &history_key(&root, &path),
        &text,
        chrono::Local::now().naive_local(),
        false,
        history::DEFAULT_INTERVAL_MINUTES,
    ) {
        eprintln!("版を残せなかった: {error}");
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct HistoryEntry {
    pub stamp: String,
    pub path: String,
}

#[tauri::command]
pub fn history_list(root: String, path: String) -> Result<Vec<HistoryEntry>, String> {
    let path = guarded(&root, &path)?;
    Ok(
        history::versions(&history_root(&root), &history_key(&root, &path))
            .into_iter()
            .map(|version| HistoryEntry {
                stamp: version.saved_at.format("%Y-%m-%d %H:%M:%S").to_string(),
                path: version.path.to_string_lossy().into_owned(),
            })
            .collect(),
    )
}

/// 版を書き戻す。戻す前に今の内容を 1 版残す（取り消せない操作を増やさない）。
/// 返り値は書き戻したあとの本文（フロントがエディタへ流し込む）。
#[tauri::command]
pub fn history_restore(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    version: String,
) -> Result<String, String> {
    let note = guarded(&root, &path)?;
    let version = guarded(&root, &version)?;
    let store = history_root(&root);
    let key = history_key(&root, &note);
    let now = chrono::Local::now().naive_local();
    if let Ok(current) = fs::read_to_string(&note) {
        if let Err(error) = history::keep(&store, &key, &current, now, true, 0) {
            eprintln!("戻す前の版を残せなかった: {error}");
        }
    }
    let text = fs::read_to_string(&version).map_err(|e| e.to_string())?;
    state.suppressor.mark(&note);
    autosave::save_atomic(&note, &text).map_err(|e| e.to_string())?;
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &note))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(text)
}

/// 競合の「両方残す」（spec §7.5）。自分の版を
/// `名前 (競合 YYYY-MM-DD).md` に保存し、その場所を返す。
/// 元のファイルは触らない（外部の版がそのまま残る）。
#[tauri::command]
pub fn conflict_copy(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    text: String,
) -> Result<String, String> {
    let note = guarded(&root, &path)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let copy = crate::vault::conflict_copy_path(&note, &today);
    state.suppressor.mark(&copy);
    autosave::save_atomic(&copy, &text).map_err(|e| e.to_string())?;
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &copy))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(copy.to_string_lossy().into_owned())
}

/// 書き出しの保存（HTML など）。保存先はネイティブの保存ダイアログで
/// ユーザーが選んだパスなので、vault の封じ込め検査は掛けない
/// （掛けると書き出し先を vault の中に縛ってしまう）。
#[tauri::command]
pub fn export_write(path: String, text: String) -> Result<(), String> {
    crate::autosave::save_bytes_atomic(Path::new(&path), text.as_bytes()).map_err(|e| e.to_string())
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

/// 本文の画像参照を data URL で返す（ADR-0004）。解決の起点は vault ルート。
#[tauri::command]
pub fn image_read(root: String, path: String) -> Result<String, String> {
    crate::assets::read_data_url(Path::new(&root), Path::new(&path)).map_err(|e| e.to_string())
}

/// 画像などの添付を `attachments/` へ保存し、本文へ挿す Markdown を返す
/// （TASKS 1-2）。中身は base64 で受ける（Tauri の JSON 経路で運ぶため）。
#[tauri::command]
pub fn attachment_save(root: String, data: String, suffix: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    let vault = Vault::new(&root);
    let saved = vault
        .add_attachment(&bytes, &suffix)
        .map_err(|e| e.to_string())?;
    Ok(vault.attachment_link(&saved))
}

/// タグと件数（サイドバーのタグ一覧）。
#[tauri::command]
pub fn tag_list(root: String) -> Result<Vec<(String, i64)>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.tag_list())
        .map_err(|e| e.to_string())
}

/// 一覧の素材（題名・プレビュー・更新時刻）。並び順はフロント側の持ち物。
#[tauri::command]
pub fn note_list(root: String) -> Result<Vec<crate::index_db::NoteMeta>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.list_notes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_search(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.search(&query))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_create(
    state: tauri::State<WatchState>,
    root: String,
    title: String,
) -> Result<String, String> {
    let vault = Vault::new(&root);
    let path = vault.create(&title).map_err(|e| e.to_string())?;
    state.suppressor.mark(&path);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn note_rename(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    title: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let renamed = Vault::new(&root)
        .rename(&path, &title)
        .map_err(|e| e.to_string())?;
    state.suppressor.mark(&renamed);
    // 索引: 旧パスを外し、新パスを載せ直す
    let vault = Vault::new(&root);
    if let Err(error) = IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
        db.remove(&vault, &path)?;
        db.upsert(&vault, &renamed)
    }) {
        eprintln!("索引の更新に失敗した: {error}");
    }
    // 鍵がパスなので、置き場を付け替えないと履歴が見えなくなる
    if let Err(error) = history::rekey(
        &history_root(&root),
        &history_key(&root, &path),
        &history_key(&root, &renamed),
    ) {
        eprintln!("履歴の置き場を移せなかった: {error}");
    }
    Ok(renamed.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn note_trash(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let vault = Vault::new(&root);
    let moved = vault.trash(&path).map_err(|e| e.to_string())?;
    state.suppressor.mark(&moved);
    // ゴミ箱の中は索引に入れない（検索・一覧の対象外）
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.remove(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn trash_list(root: String) -> Result<Vec<String>, String> {
    Ok(Vault::new(&root)
        .trash_list()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

/// ゴミ箱の 1 件を完全に消す（G-3）。ゴミ箱の外は消さない。
#[tauri::command]
pub fn trash_delete(root: String, path: String) -> Result<(), String> {
    Vault::new(&root)
        .delete_permanently(Path::new(&path))
        .map_err(|e| e.to_string())
}

/// ゴミ箱を空にする（G-3）。確認を取るのはフロント側の仕事。
#[tauri::command]
pub fn trash_empty(root: String) -> Result<(), String> {
    Vault::new(&root)
        .empty_trash()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_restore(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let vault = Vault::new(&root);
    let restored = vault.restore(&path).map_err(|e| e.to_string())?;
    state.suppressor.mark(&restored);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &restored))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(restored.to_string_lossy().into_owned())
}
