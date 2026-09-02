// 覚書（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

pub mod autosave;
pub mod commands;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::note_read,
            commands::note_write,
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
