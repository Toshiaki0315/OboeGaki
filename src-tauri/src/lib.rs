// 覚書（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

pub mod assets;
pub mod autosave;
pub mod commands;
pub mod front_matter;
mod history;
pub mod index_db;
pub mod recovery;
pub mod search_query;
pub mod tags;
pub mod template;
pub mod vault;
pub mod vault_lock;
pub mod watcher;
pub mod wikilink;

use std::sync::OnceLock;
use std::time::Instant;

/// プロセス開始時刻。起動時間の実測（spec §6.6: 起動 < 1.5 秒）に使う。
static STARTED: OnceLock<Instant> = OnceLock::new();

pub fn started() -> Instant {
    *STARTED.get_or_init(Instant::now)
}

/// ネイティブのメニューバー（参照実装 ui/menus.py の役目）。
/// 押されたら "menu" イベントでフロントへ流し、動作はフロント側が持つ。
///
/// アクセラレータはメニューが WebView より先に受け取るので、ここに載せる
/// ショートカットはアプリ層のもの（Cmd+N/S/O/5 など）に限る。エディタ内の
/// 書式ショートカット（Cmd+B 等）は CM6 のキーマップに残し、メニューには
/// 載せない（載せると入力中のキーを横取りしてしまう）。
fn build_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    let handle = app.handle();
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if let Some(keys) = accelerator {
            builder = builder.accelerator(keys);
        }
        builder.build(handle)
    };

    let application = SubmenuBuilder::new(handle, "覚書")
        .about(None)
        .separator()
        .item(&item("preferences", "環境設定…", Some("CmdOrCtrl+,"))?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(handle, "ファイル")
        .item(&item("new-note", "新規ノート", Some("CmdOrCtrl+N"))?)
        .item(&item(
            "new-from-template",
            "テンプレートから新規…",
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&item("daily-note", "今日のノート", Some("CmdOrCtrl+T"))?)
        .item(&item("move-note", "フォルダへ移動…", None)?)
        .item(&item("open-vault", "保管フォルダを開く…", None)?)
        .separator()
        // 手入れ（M-6）。監視が取りこぼしたぶんを押せば必ず合わせられる
        .item(&item("resync", "最新の情報に同期", None)?)
        .item(&item("rebuild-index", "索引を作り直す", None)?)
        .separator()
        .item(&item("save", "保存", Some("CmdOrCtrl+S"))?)
        .item(&item("export-html", "HTML に書き出し…", None)?)
        .separator()
        .item(&item("history", "版の履歴…", None)?)
        .item(&item("trash", "ゴミ箱へ移動", None)?)
        .build()?;
    let edit = SubmenuBuilder::new(handle, "編集")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        // 書式（B-1）。エディタのキー（Cmd+B 等）は横取りしないよう
        // アクセラレータを付けない
        .item(&item("format-heading", "見出し（段落⇄H1⇄H2⇄H3）", None)?)
        .item(&item("format-bullet", "箇条書き", None)?)
        .item(&item("format-ordered", "番号付きリスト", None)?)
        .item(&item("format-quote", "引用", None)?)
        .separator()
        .item(&item("insert-table", "表を挿入…", None)?)
        .build()?;
    let view = SubmenuBuilder::new(handle, "表示")
        .item(&item(
            "quick-open",
            "クイックオープン",
            Some("CmdOrCtrl+O"),
        )?)
        .item(&item(
            "search-all",
            "全ノート検索",
            Some("CmdOrCtrl+Shift+F"),
        )?)
        .separator()
        // ペインの開閉（spec §5.1 / §5.4）
        .item(&item(
            "toggle-trees",
            "サイドバー（フォルダ・タグ）",
            Some("CmdOrCtrl+1"),
        )?)
        .item(&item("toggle-notes", "ノート一覧", Some("CmdOrCtrl+2"))?)
        .separator()
        // アクセラレータを付けない: メニューのそれは US 配列の物理キーで
        // 解釈され、JIS では Cmd+= が別のキーに化けた（実機報告）。
        // ショートカットは WebView 側の keydown（event.key）が担う
        .item(&item("zoom-in", "文字を大きく（Cmd+=）", None)?)
        .item(&item("zoom-out", "文字を小さく（Cmd+-）", None)?)
        .item(&item("zoom-reset", "標準の大きさ（Cmd+0）", None)?)
        .separator()
        .item(&item(
            "heading-palette",
            "見出しへ飛ぶ…",
            Some("CmdOrCtrl+R"),
        )?)
        .item(&item("outline", "アウトライン", Some("CmdOrCtrl+5"))?)
        .item(&item("source-mode", "ソースモード", Some("CmdOrCtrl+/"))?)
        .item(&item(
            "focus-mode",
            "フォーカスモード",
            Some("CmdOrCtrl+Shift+D"),
        )?)
        .item(&item(
            "typewriter",
            "タイプライタモード",
            Some("CmdOrCtrl+Shift+Y"),
        )?)
        .build()?;
    let help = SubmenuBuilder::new(handle, "ヘルプ")
        .item(&item("place-manual", "使い方のノートを置き直す", None)?)
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&application, &file, &edit, &view, &help])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        use tauri::Emitter;
        let _ = app.emit("menu", event.id().0.clone());
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = STARTED.set(Instant::now());
    tauri::Builder::default()
        // 二重起動を止める（H-1 層 2）。2 つ目を起動したら、**今ある窓を
        // 前に出す**（同じ vault を 2 窓で開くと watcher が互いの保存に
        // 反応し、競合ダイアログが行き来する）。
        // 別の窓が別の vault を開いている場合の取りこぼしは vault ロックが拾う
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            // 既定のラベルは "main"。設定で変えても拾えるよう保険を置く
            let found = app
                .get_webview_window("main")
                .or_else(|| app.webview_windows().values().next().cloned());
            if let Some(window) = found {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // 窓の位置と大きさを覚える（TASKS 3-8 / config.window_geometry の役目）。
        //
        // **表示状態（VISIBLE）と枠（DECORATIONS）は覚えない。** 参照実装は
        // `Cmd+H` で隠してから終了すると次の起動が真っ白な窓になる穴を踏んで
        // いる。位置と大きさだけなら、隠れて出てこない窓は作れない。
        // 画面構成が変わって窓が画面の外に落ちる場合はプラグインが位置を
        // 捨てる（保存された位置と重なるモニタが無ければ OS に任せる）
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            build_menu(app)?;
            Ok(())
        })
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::note_list,
            commands::tag_list,
            commands::notes_with_tag,
            commands::template_list,
            commands::template_register,
            commands::note_duplicate,
            commands::note_create_from_template,
            commands::note_daily,
            commands::manual_place,
            commands::folder_list,
            commands::notes_in_folder,
            commands::folder_create,
            commands::folder_rename,
            commands::folder_delete,
            commands::note_move,
            commands::note_backlinks,
            commands::index_sync,
            commands::recovery_stash,
            commands::recovery_discard,
            commands::recovery_pending,
            commands::recovery_restore,
            commands::recovery_clear,
            commands::note_exists,
            commands::note_read,
            commands::note_write,
            commands::note_create,
            commands::note_rename,
            commands::note_trash,
            commands::trash_list,
            commands::note_restore,
            commands::note_pin,
            commands::trash_delete,
            commands::trash_empty,
            commands::note_search,
            commands::image_read,
            commands::attachment_save,
            commands::history_list,
            commands::history_restore,
            commands::export_write,
            commands::conflict_copy,
            commands::startup_elapsed_ms,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // cargo test の配線確認。実テストは各モジュールにある
    #[test]
    fn test_テスト基盤が動く() {
        assert_eq!(1 + 1, 2);
    }
}
