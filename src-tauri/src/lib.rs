// 覚書（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

pub mod assets;
pub mod autosave;
pub mod commands;
pub mod history;
pub mod index_db;
pub mod vault;
pub mod watcher;

use std::sync::OnceLock;
use std::time::Instant;

/// プロセス開始時刻。起動時間の実測（spec §6.6: 起動 < 1.5 秒）に使う。
static STARTED: OnceLock<Instant> = OnceLock::new();

pub fn started() -> Instant {
    *STARTED.get_or_init(Instant::now)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = STARTED.set(Instant::now());
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::note_read,
            commands::note_write,
            commands::note_create,
            commands::note_rename,
            commands::note_trash,
            commands::trash_list,
            commands::note_restore,
            commands::note_search,
            commands::image_read,
            commands::history_list,
            commands::history_restore,
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
