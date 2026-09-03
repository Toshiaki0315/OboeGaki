// 覚書（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

pub mod assets;
pub mod autosave;
pub mod commands;
pub mod front_matter;
mod history;
pub mod index_db;
pub mod tags;
pub mod vault;
pub mod watcher;

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
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(handle, "ファイル")
        .item(&item("new-note", "新規ノート", Some("CmdOrCtrl+N"))?)
        .item(&item("open-vault", "保管フォルダを開く…", None)?)
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
        // アクセラレータを付けない: メニューのそれは US 配列の物理キーで
        // 解釈され、JIS では Cmd+= が別のキーに化けた（実機報告）。
        // ショートカットは WebView 側の keydown（event.key）が担う
        .item(&item("zoom-in", "文字を大きく（Cmd+=）", None)?)
        .item(&item("zoom-out", "文字を小さく（Cmd+-）", None)?)
        .item(&item("zoom-reset", "標準の大きさ（Cmd+0）", None)?)
        .separator()
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
    let menu = MenuBuilder::new(handle)
        .items(&[&application, &file, &edit, &view])
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
