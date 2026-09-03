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
    /// 開いている vault のロック（H-1 層 2）。**開いている間は持ち続ける**
    /// （手放すと OS がロックを外す）。別の vault を開いたら置き換える。
    lock: Mutex<Option<crate::vault_lock::VaultLock>>,
    /// 走査が動いているか（M-6）。**二重に走らせない** — 同じ索引を
    /// 2 本で書くと、片方の見た「消えた」がもう片方の書き込みを消す
    syncing: Arc<std::sync::atomic::AtomicBool>,
    /// 生成が走っているか（TASKS 4-8）。**答えの途中でモデルを降ろさない**
    /// ためと、二重に始めないため
    generating: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            suppressor: Arc::new(Suppressor::default()),
            lock: Mutex::new(None),
            syncing: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            generating: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

/// フロント（lib/last-vault.ts）と揃える印。二重起動の断りだけに付ける。
const VAULT_BUSY: &str = "vault-busy";

/// ゴミ箱に置いておく日数の既定（spec §7.6）。環境設定で変えられる
/// （フロントの lib/settings.ts と同じ値）。
const DEFAULT_TRASH_DAYS: u64 = 30;

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
    trash_days: Option<u64>,
) -> Result<Vec<String>, String> {
    let vault = Vault::new(&root);
    vault.ensure_layout().map_err(|e| e.to_string())?;
    // 同じ vault の二重起動を止める（H-1 層 2 / spec §6.1）。2 窓で開くと
    // watcher が互いの保存に反応し、競合ダイアログが行き来する。
    // **先に手放してから取る** — 同じ vault を開き直すとき、自分の持って
    // いるロックに自分でぶつかる
    {
        let mut held = state.lock.lock().expect("vault lock");
        *held = None;
        match crate::vault_lock::acquire(&vault.managed_dir()) {
            crate::vault_lock::LockOutcome::Acquired(lock) => *held = Some(lock),
            crate::vault_lock::LockOutcome::Busy => {
                // 頭の印はフロントが「開けない」と区別するためのもの
                // （記憶している vault を忘れるかどうかが変わる）
                return Err(format!(
                    "{VAULT_BUSY}: この保管フォルダは既に別のウィンドウで開いています。そちらをお使いください。"
                ));
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
        Ok(active) => *state.watcher.lock().expect("watcher lock") = Some(active),
        Err(error) => eprintln!("外部変更の監視を開始できなかった: {error}"),
    }
    // 索引の全体同期と履歴の掃除は背景で行う（5,000 ノートで 2.2 秒 —
    // bench.md）。終わったら index-updated でフロントが一覧を引き直す
    {
        let root = root.clone();
        let app = app.clone();
        let days = trash_days.unwrap_or(DEFAULT_TRASH_DAYS);
        std::thread::spawn(move || {
            use tauri::Emitter;
            let vault = Vault::new(&root);
            if let Err(error) =
                IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.sync(&vault))
            {
                eprintln!("索引の同期に失敗した（検索は古いままになる）: {error}");
            }
            history::prune(&history_root(&root), chrono::Local::now().naive_local());
            // 期限切れのゴミも一緒に掃除する（spec §7.6。日数は環境設定）
            if let Err(error) = vault.purge_trash(days) {
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

/// そのノートが今もあるか（spec §7.5）。
///
/// 改名やゴミ箱移動の途中でも「消えた」イベントは届くので、
/// **本当に無いときだけ聞く**ために使う。
#[tauri::command]
pub fn note_exists(root: String, path: String) -> Result<bool, String> {
    let path = guarded(&root, &path)?;
    Ok(path.is_file())
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
    // 版を残す間隔（分。環境設定）。0 は「なし」= 自分で保存したときだけ
    history_minutes: Option<i64>,
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
        history_minutes.unwrap_or(history::DEFAULT_INTERVAL_MINUTES),
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

/// ノートを複製する（一覧の右クリック）。作った先を返す。
#[tauri::command]
pub fn note_duplicate(
    state: tauri::State<WatchState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    let copy = vault.duplicate(&path).map_err(|e| e.to_string())?;
    state.suppressor.mark(&copy);
    index_one(&vault, &copy);
    Ok(copy.to_string_lossy().into_owned())
}

/// ノートを雛形として登録する（一覧の右クリック）。置いた場所を返す。
#[tauri::command]
pub fn template_register(root: String, path: String, name: String) -> Result<String, String> {
    let path = guarded(&root, &path)?;
    Vault::new(&root)
        .register_template(&path, &name)
        .map(|placed| placed.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// どのノートからも指されていない添付（E-5）。絶対パスを名前順で返す。
#[tauri::command]
pub fn attachments_unused(root: String) -> Result<Vec<String>, String> {
    Ok(Vault::new(&root)
        .unused_attachments()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// 添付をゴミ箱へ移す（E-5）。移した数を返す。
#[tauri::command]
pub fn attachments_trash(
    state: tauri::State<WatchState>,
    root: String,
    paths: Vec<String>,
) -> Result<usize, String> {
    let vault = Vault::new(&root);
    let mut targets = Vec::new();
    for path in paths {
        let path = guarded(&root, &path)?;
        state.suppressor.mark(&path);
        targets.push(path);
    }
    Ok(vault.trash_attachments(&targets).len())
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

/// 検索の結果。読めなかった `after:` / `before:` を一緒に返す。
///
/// **探すのはやめない**（言葉として扱う）が、書き方が違うことは画面から
/// 読めるようにする。0 件になった理由が分からないと打ち間違いに気づけない。
#[derive(serde::Serialize)]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub unreadable: Vec<String>,
}

#[tauri::command]
pub fn note_search(root: String, query: String) -> Result<SearchOutcome, String> {
    let vault = Vault::new(&root);
    let hits = IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.search(&query))
        .map_err(|e| e.to_string())?;
    Ok(SearchOutcome {
        hits,
        unreadable: crate::search_query::parse(&query).unreadable_dates,
    })
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

/// このノートを `[[…]]` で指しているノート（E-6）。
#[tauri::command]
pub fn note_backlinks(
    root: String,
    title: String,
) -> Result<Vec<crate::index_db::Backlink>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.backlinks(&title))
        .map_err(|e| e.to_string())
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
    state: tauri::State<WatchState>,
    root: String,
    full: bool,
) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    if state.syncing.swap(true, Ordering::SeqCst) {
        return Ok(false); // 走査中。**押しても無反応に見せない**のは呼ぶ側
    }
    let syncing = state.syncing.clone();
    std::thread::spawn(move || {
        use tauri::Emitter;
        let vault = Vault::new(&root);
        let outcome = IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
            if full {
                db.rebuild(&vault)
            } else {
                db.sync(&vault)
            }
        });
        syncing.store(false, Ordering::SeqCst);
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

/// 書き出したファイルをそのまま置く（base64 で受け取る）。
///
/// PowerPoint（TASKS 4-5）のように**中身がバイト列**のものに使う。
/// 置き場はユーザーが選んだ場所なので vault の外でよい。
#[tauri::command]
pub fn export_write_binary(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// 取り込むファイルを base64 で読む（TASKS 4-5 の PowerPoint など）。
///
/// **vault の外を読む。** 取り込みは外から持ってくる操作で、置き場を
/// 選ぶのはユーザー。書き込みはしないので、封じ込めの対象にしない。
#[tauri::command]
pub fn import_read(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ------------------------------------------------------------ ローカルLLM

/// Ollama が動いているか（TASKS 4-8 / ADR-0025）。
///
/// **押してから断らない**ための確認。動いていなければ機能ごと畳む。
#[tauri::command]
pub fn llm_available(port: u16) -> bool {
    crate::llm::available(port)
}

/// 入っているモデルの名前（設定の候補に出す）。
#[tauri::command]
pub fn llm_models(port: u16) -> Vec<String> {
    crate::llm::models(port)
}

/// そのモデルが今メモリに載っているか（載っていなければ「読み込んで
/// います…」と言えるようにする）。
#[tauri::command]
pub fn llm_loaded(port: u16, model: String) -> bool {
    crate::llm::is_loaded(port, &model)
}

/// モデルをメモリから降ろす。**答えの途中では降ろさない**（走っている
/// 生成を壊す）ので、走っている間は断る。
#[tauri::command]
pub fn llm_unload(
    state: tauri::State<WatchState>,
    port: u16,
    model: String,
) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    if state.generating.load(Ordering::SeqCst) {
        return Ok(false);
    }
    crate::llm::unload(port, &model).map_err(|e| e.to_string())?;
    Ok(true)
}

/// ノートを読ませる（TASKS 4-8）。始めたら true、走っている最中なら false。
///
/// **打鍵の経路に入れない**（spec §6.6）。生成は別スレッドで回し、流れて
/// きたぶんは `llm-chunk` で送る（最初の 1 文字まで数秒あり、黙って
/// 待たせない）。終わりは `llm-done`、失敗は `llm-failed`。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn llm_generate(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    port: u16,
    model: String,
    task: String,
    title: String,
    body: String,
    context: u32,
    timeout_minutes: u64,
    keep_alive: String,
) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    if state.generating.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    let generating = state.generating.clone();
    std::thread::spawn(move || {
        use tauri::Emitter;
        let prompt = crate::llm::prompt_for(&task, &title, &body);
        let outcome = crate::llm::generate(
            port,
            &model,
            &prompt,
            context,
            std::time::Duration::from_secs(timeout_minutes * 60),
            &keep_alive,
            |piece| {
                let _ = app.emit("llm-chunk", piece);
            },
        );
        generating.store(false, Ordering::SeqCst);
        match outcome {
            Ok(answer) => {
                let _ = app.emit("llm-done", answer);
            }
            Err(error) => {
                let _ = app.emit("llm-failed", error.to_string());
            }
        }
    });
    Ok(true)
}

/// 絵から文字を読む（TASKS 4-7 / ADR-0041）。読めなければ空。
///
/// 受け取るのは base64 の画像。**元のファイルは触らない** — 読み取った
/// 文字を返すだけで、ノートにするのは呼び出し側の仕事。
#[tauri::command]
pub fn ocr_image(data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    Ok(crate::ocr::recognize(&bytes))
}

/// 印刷（TASKS 4-3）。macOS の印刷パネルを出す（「PDF として保存」もここ）。
///
/// 印刷されるのは**この WebView に今出ているもの**なので、何を出すかは
/// フロント側の `@media print` が決める（ADR-0038）。
#[tauri::command]
pub fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// 退避の置き場（vault ごと）。アプリのデータフォルダの下に作る。
///
/// vault の中に置かないのは、**保存できない理由が vault 側にあることが多い**
/// ため（権限・容量・同期の衝突）。書けない場所へ保険を置いても保険にならない。
fn recovery_dir(app: &tauri::AppHandle, root: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(crate::recovery::vault_dir(&base, Path::new(root)))
}

/// 未保存の内容を退避する（保存できないまま落ちたときの保険）。
#[tauri::command]
pub fn recovery_stash(
    app: tauri::AppHandle,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    let path = guarded(&root, &path)?;
    let dir = recovery_dir(&app, &root)?;
    crate::recovery::stash(&dir, &path, &text)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 保存できたので退避を捨てる。
#[tauri::command]
pub fn recovery_discard(app: tauri::AppHandle, root: String, path: String) -> Result<(), String> {
    let path = guarded(&root, &path)?;
    crate::recovery::discard(&recovery_dir(&app, &root)?, &path);
    Ok(())
}

/// 前回の未保存内容（起動時に拾う）。
#[tauri::command]
pub fn recovery_pending(
    app: tauri::AppHandle,
    root: String,
) -> Result<Vec<crate::recovery::Stashed>, String> {
    Ok(crate::recovery::pending(&recovery_dir(&app, &root)?))
}

/// 退避を**別ファイルとして**書き出す。書いた場所を返す。
///
/// 元のファイルは上書きしない。書き出したら退避は捨てる（同じものを
/// 次の起動でもう一度勧めない）。
#[tauri::command]
pub fn recovery_restore(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    root: String,
) -> Result<Vec<String>, String> {
    let vault = Vault::new(&root);
    let dir = recovery_dir(&app, &root)?;
    let mut restored = Vec::new();
    for stashed in crate::recovery::pending(&dir) {
        let source = Path::new(&stashed.source);
        let stamp = chrono::DateTime::from_timestamp_millis(stashed.stashed_at_ms)
            .map(|at| {
                at.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string()
            })
            .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        match vault.restore_stash(source, &stashed.text, &stamp) {
            Ok(path) => {
                state.suppressor.mark(&path);
                index_one(&vault, &path);
                restored.push(path.to_string_lossy().into_owned());
            }
            // 1 つ書けなくても残りは救う
            Err(error) => eprintln!("退避を復元できなかった（{}）: {error}", stashed.source),
        }
    }
    crate::recovery::clear_all(&dir);
    Ok(restored)
}

/// 退避を全部捨てる（「復元しない」を選んだとき）。
#[tauri::command]
pub fn recovery_clear(app: tauri::AppHandle, root: String) -> Result<(), String> {
    crate::recovery::clear_all(&recovery_dir(&app, &root)?);
    Ok(())
}

/// 関連するノート（L-3）。**モデルは通さない** — 根拠は索引の中にある
/// ので、Ollama を入れていなくても出る。
#[derive(serde::Serialize)]
pub struct RelatedNote {
    /// vault からの相対パス
    pub path: String,
    pub title: String,
    /// 出た理由（**そのまま画面に出す**。読めないと確かめようがない）
    pub reasons: Vec<String>,
}

#[tauri::command]
pub fn note_related(root: String, path: String, title: String) -> Result<Vec<RelatedNote>, String> {
    let vault = Vault::new(&root);
    let relative = Path::new(&path)
        .strip_prefix(&root)
        .map(|rest| rest.to_string_lossy().into_owned())
        .unwrap_or(path.clone());
    let db = IndexDb::open(&vault.managed_dir()).map_err(|e| e.to_string())?;
    let signals = db
        .related_signals(&relative, &title)
        .map_err(|e| e.to_string())?;
    let ranked = crate::related::rank(&signals, &relative, crate::related::DEFAULT_LIMIT);
    let titles: std::collections::HashMap<String, String> = db
        .list_notes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|note| (note.path, note.title))
        .collect();
    Ok(ranked
        .into_iter()
        .map(|item| RelatedNote {
            title: titles
                .get(&item.key)
                .cloned()
                .unwrap_or_else(|| item.key.clone()),
            path: item.key,
            reasons: item.reasons,
        })
        .collect())
}

/// リンクの図の素材（M-2）。`(指すノートの題名, 指し先, 続柄)`。
///
/// **図は索引から作る。** 本文を全部読み直すと大きな vault で待たされる。
#[tauri::command]
pub fn link_map(root: String) -> Result<Vec<(String, String, String)>, String> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.link_map())
        .map_err(|e| e.to_string())
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
