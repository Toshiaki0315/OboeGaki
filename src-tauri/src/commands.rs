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
use crate::vault::{contains, NewNote, Vault};
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

/// そのタグ（と配下のタグ）が付いたノートだけの一覧（C-4）。
/// サイドバーのタグクリックはこれで絞る。
#[tauri::command]
pub fn notes_with_tag(root: String, tag: String) -> Result<Vec<crate::index_db::NoteMeta>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.notes_with_tag(&tag))
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

/// `templates/` にある雛形の一覧（絶対パス。名前順）。
#[tauri::command]
pub fn template_list(root: String) -> Result<Vec<String>, String> {
    Ok(Vault::new(&root)
        .templates()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// 雛形から新しいノートを作る（E-4）。題名が空なら雛形の名前を使う。
#[tauri::command]
pub fn note_create_from_template(
    state: tauri::State<WatchState>,
    root: String,
    template: String,
    title: String,
) -> Result<NewNote, String> {
    let vault = Vault::new(&root);
    let made = vault
        .create_from_template(Path::new(&template), &title, &chrono::Local::now())
        .map_err(|e| e.to_string())?;
    state.suppressor.mark(&made.path);
    index_one(&vault, &made.path);
    Ok(made)
}

/// 今日のノート（E-4）。無ければ日次の雛形から作る。
#[tauri::command]
pub fn note_daily(state: tauri::State<WatchState>, root: String) -> Result<NewNote, String> {
    let vault = Vault::new(&root);
    let made = vault
        .daily_note(&chrono::Local::now())
        .map_err(|e| e.to_string())?;
    state.suppressor.mark(&made.path);
    index_one(&vault, &made.path);
    Ok(made)
}

/// 使い方のノートを今の内容で置き直す（ヘルプメニュー）。
#[tauri::command]
pub fn manual_place(state: tauri::State<WatchState>, root: String) -> Result<String, String> {
    let vault = Vault::new(&root);
    let placed = vault.place_manual().map_err(|e| e.to_string())?;
    state.suppressor.mark(&placed);
    index_one(&vault, &placed);
    Ok(placed.to_string_lossy().into_owned())
}

/// サイドバーのフォルダツリーの素材（ADR-0024）。
/// **存在はディスク、件数は索引**（索引にあってディスクに無いものは出さない）。
/// 先頭は必ず直下（空文字）。
#[tauri::command]
pub fn folder_list(root: String) -> Result<Vec<(String, i64)>, String> {
    let vault = Vault::new(&root);
    let counts = IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.folder_counts())
        .map_err(|e| e.to_string())?;
    let count_of = |folder: &str| counts.get(folder).copied().unwrap_or(0);
    let mut found = vec![(String::new(), count_of(""))];
    for folder in vault.folders() {
        let count = count_of(&folder);
        found.push((folder, count));
    }
    Ok(found)
}

/// そのフォルダ**直下**のノート（ADR-0024 追記 4）。
#[tauri::command]
pub fn notes_in_folder(
    root: String,
    folder: String,
) -> Result<Vec<crate::index_db::NoteMeta>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.notes_in_folder(&folder))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folder_create(root: String, folder: String) -> Result<String, String> {
    Vault::new(&root)
        .create_folder(&folder)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// フォルダの名前を変える。新しい相対パスを返す。
///
/// 中のノートはパスが変わるので、索引を取り直し、履歴の置き場も
/// 付け替える（鍵がパスなので、そのままだと履歴が見えなくなる）。
#[tauri::command]
pub fn folder_rename(
    state: tauri::State<WatchState>,
    root: String,
    folder: String,
    name: String,
) -> Result<String, String> {
    let vault = Vault::new(&root);
    let before = folder.trim_matches('/').to_string();
    let renamed = vault
        .rename_folder(&folder, &name)
        .map_err(|e| e.to_string())?;
    let moved: Vec<std::path::PathBuf> = vault
        .scan()
        .into_iter()
        .filter(|path| {
            path.strip_prefix(vault.root())
                .map(|relative| relative.starts_with(&renamed))
                .unwrap_or(false)
        })
        .collect();
    for path in &moved {
        state.suppressor.mark(path);
        let after = history_key(&root, path);
        // 旧鍵は、新しい相対パスの頭を元の名前へ戻したもの
        let old_key = after.replacen(&format!("path:{renamed}"), &format!("path:{before}"), 1);
        if let Err(error) = history::rekey(&history_root(&root), &old_key, &after) {
            eprintln!("履歴の置き場を移せなかった: {error}");
        }
    }
    if let Err(error) = IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(&vault)) {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(renamed)
}

#[tauri::command]
pub fn folder_delete(root: String, folder: String) -> Result<(), String> {
    Vault::new(&root)
        .delete_folder(&folder)
        .map_err(|e| e.to_string())
}

/// ノートをフォルダへ移す（ADR-0024）。移した先の絶対パスを返す。
#[tauri::command]
pub fn note_move(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    folder: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    state.suppressor.mark(&path);
    let moved = vault.move_note(&path, &folder).map_err(|e| e.to_string())?;
    if moved == path {
        return Ok(moved.to_string_lossy().into_owned());
    }
    state.suppressor.mark(&moved);
    if let Err(error) = IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
        db.remove(&vault, &path)?;
        db.upsert(&vault, &moved)
    }) {
        eprintln!("索引の更新に失敗した: {error}");
    }
    // 鍵がパスなので、置き場を付け替えないと履歴が見えなくなる
    if let Err(error) = history::rekey(
        &history_root(&root),
        &history_key(&root, &path),
        &history_key(&root, &moved),
    ) {
        eprintln!("履歴の置き場を移せなかった: {error}");
    }
    Ok(moved.to_string_lossy().into_owned())
}

/// 作ったばかりの 1 ファイルを索引へ。失敗しても作成自体は成功なので
/// ログだけ残す（全体の整合は vault_open の同期が取り直す）。
fn index_one(vault: &Vault, path: &Path) {
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(vault, path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
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
    // ピン留め中は捨てない（spec §7.3 の削除ガード）。
    // 消してよいなら先にピンを外す、という一拍を挟む
    if std::fs::read_to_string(&path)
        .map(|text| crate::front_matter::pinned(&text))
        .unwrap_or(false)
    {
        return Err("ピン留め中のノートはゴミ箱へ移せない（先にピンを外す）".into());
    }
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

/// ピン留めを付け外しする（spec §7.3）。front matter の `pinned: true` に
/// 永続化し、書き換え後の本文を返す（開いているエディタが差し替えるため）。
#[tauri::command]
pub fn note_pin(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
    pinned: bool,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let updated = crate::front_matter::with_pinned(&text, pinned);
    if updated != text {
        state.suppressor.mark(&path);
        autosave::save_atomic(&path, &updated).map_err(|e| e.to_string())?;
        let vault = Vault::new(&root);
        if let Err(error) =
            IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
        {
            eprintln!("索引の更新に失敗した: {error}");
        }
    }
    Ok(updated)
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
