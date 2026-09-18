// おぼえがき（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

// テストの中の unwrap は設計どおり（CLAUDE.md §6）。本番コードだけ lint で止める
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod assets;
pub mod autosave;
pub mod commands;
pub mod front_matter;
mod history;
pub mod index_db;
pub mod link_rewrite;
pub mod llm;
pub mod mcp;
pub mod note_service;
pub mod ocr;
pub mod pdf;
pub mod recovery;
pub mod references;
pub mod related;
pub mod search_query;
pub mod tags;
pub mod tasks;
pub mod template;
pub mod text_rewrite;
pub mod vault;
pub mod vault_lock;
pub mod watcher;
pub mod wikilink;

#[cfg(test)]
pub(crate) mod test_support;

use std::sync::OnceLock;
use std::time::Instant;

/// プロセス開始時刻。起動時間の実測（spec §6.6: 起動 < 1.5 秒）に使う。
static STARTED: OnceLock<Instant> = OnceLock::new();

pub fn started() -> Instant {
    *STARTED.get_or_init(Instant::now)
}

pub mod menu;
use menu::build_menu;
pub use menu::{about_lines, about_versions, AboutLines, MenuChecks, StandardLabels};

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
        // クリップボード（要望 2026-09-04）。**WebView の読み取りは通らない** —
        // 本文の右クリックからの貼り付けが動かなかったので、Rust 側から読む
        // どこからでも書き取り（ADR-0057）。登録はフロントが設定を見て行う
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            build_menu(app)?;
            Ok(())
        })
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::default_vault,
            commands::note_list,
            commands::tag_list,
            commands::notes_with_tag,
            commands::template_list,
            commands::template_register,
            commands::note_duplicate,
            commands::attachments_unused,
            commands::attachments_trash,
            commands::note_create_from_template,
            commands::note_daily,
            commands::manual_place,
            commands::folder_list,
            commands::notes_in_folder,
            commands::folder_create,
            commands::folder_rename,
            commands::folder_move,
            commands::vault_is_empty,
            commands::folder_delete,
            commands::note_move,
            commands::note_backlinks,
            commands::link_map,
            commands::note_related,
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
            commands::history_usage,
            commands::menu_checks,
            commands::mcp_config,
            commands::mcp_hidden,
            commands::mcp_set_hidden,
            commands::mcp_manual_place,
            commands::trash_delete,
            commands::trash_empty,
            commands::note_search,
            commands::image_read,
            commands::attachment_save,
            commands::history_list,
            commands::history_restore,
            commands::history_read,
            commands::replace_preview,
            commands::replace_apply,
            commands::tag_rename,
            commands::task_list,
            commands::task_complete,
            commands::note_append_daily,
            commands::export_write,
            commands::print_page,
            commands::export_write_binary,
            commands::import_read,
            commands::ocr_image,
            commands::pdf_page_count,
            commands::ocr_pdf_page,
            commands::open_handoff_app,
            commands::open_handoff_url,
            commands::open_in_finder,
            commands::llm_available,
            commands::llm_models,
            commands::llm_loaded,
            commands::llm_unload,
            commands::llm_stop,
            commands::llm_generate,
            commands::conflict_copy,
            commands::startup_elapsed_ms,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {

    // cargo test の配線確認。実テストは各モジュールにある
    #[test]
    fn test_テスト基盤が動く() {
        assert_eq!(1 + 1, 2);
    }

    /// 版は 3 箇所（Cargo / tauri.conf / package.json）が同じ字面であること。
    /// 「について」に出るのは Cargo の版とビルド日時（要望 2026-09-10）
    #[test]
    fn test_版は3箇所が揃い_aboutにはビルド日時が付く() {
        let (short, stamp) = super::about_versions();
        // 字面は x.y.z（make bump が上げる。値そのものは固定しない）
        assert!(
            short.split('.').count() == 3 && short.split('.').all(|p| p.parse::<u32>().is_ok()),
            "版の形が違う: {short}"
        );
        assert!(!stamp.is_empty());
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], short);
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(package["version"], short);
    }

    #[test]
    fn test_設定でドラッグの横取りを切ってある() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["windows"][0]["dragDropEnabled"],
            serde_json::Value::Bool(false),
        );
    }
}
