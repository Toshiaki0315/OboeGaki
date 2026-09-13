// おぼえがき（OboeGaki）Tauri 側エントリポイント。
// vault・保存・監視などの永続化コマンドはここに載せていく
// （hitofude の core/ + storage/ に相当する層。GUI 非依存でテストする）。

pub mod assets;
pub mod autosave;
pub mod commands;
pub mod front_matter;
mod history;
pub mod index_db;
pub mod link_rewrite;
pub mod llm;
pub mod mcp;
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
    use tauri::menu::{
        CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    };
    let handle = app.handle();
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        let mut builder = MenuItemBuilder::with_id(id, label);
        if let Some(keys) = accelerator {
            builder = builder.accelerator(keys);
        }
        builder.build(handle)
    };
    // 状態を持つ項目は**印つき**にする（要望 2026-09-13）。メニューを開いた
    // ときに「今どちらか」が分かる = macOS の作法。印の付け外しは画面側から
    // `menu_checks` で伝える（状態を持つのは画面 = T2）
    let checks = MenuChecks::default();
    let toggle = |id: &str, label: &str, accelerator: Option<&str>| {
        let mut builder = CheckMenuItemBuilder::with_id(id, label).checked(false);
        if let Some(keys) = accelerator {
            builder = builder.accelerator(keys);
        }
        let built = builder.build(handle)?;
        checks.remember(id, built.clone());
        Ok::<_, tauri::Error>(built)
    };

    // 「おぼえがきについて」に出す絵（要望 2026-09-04）。**こちらから渡す** —
    // 束ねる前（`cargo tauri dev`）は .app の中に居らず、OS にはアプリの絵が
    // 分からないので、書類フォルダの絵が出てしまう
    // 名前・版・ビルド日時（要望 2026-09-10。順序の理由は about_lines）
    let lines = about_lines();
    let about = tauri::menu::AboutMetadataBuilder::new()
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")).ok())
        .name(Some(lines.name))
        .version(Some(lines.version))
        .short_version(Some(lines.short_version))
        .build();
    // 標準の項目は**呼び名を日本語で渡す**（実機 2026-09-11: Tauri の既定は
    // 英語）。呼び名は macOS 標準の日本語に合わせる（STANDARD_LABELS）
    let labels = &STANDARD_LABELS;
    let application = SubmenuBuilder::new(handle, "おぼえがき")
        .item(&PredefinedMenuItem::about(
            handle,
            Some(labels.about),
            Some(about),
        )?)
        .separator()
        .item(&item("preferences", "環境設定…", Some("CmdOrCtrl+,"))?)
        .separator()
        // 標準の「サービス」（選んだ文字を他のアプリへ渡す道）。macOS の作法で
        // ここに置く（2026-09-13 の見落とし確認で気付いた）
        .item(&PredefinedMenuItem::services(
            handle,
            Some(labels.services),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, Some(labels.hide))?)
        .item(&PredefinedMenuItem::hide_others(
            handle,
            Some(labels.hide_others),
        )?)
        .item(&PredefinedMenuItem::show_all(
            handle,
            Some(labels.show_all),
        )?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, Some(labels.quit))?)
        .build()?;
    // 手入れ（M-6）。**ふだん触らないものを畳む**（要望 2026-09-13）— 何か
    // おかしいときだけ使う 4 つが、毎日使う「新規・保存」の間に挟まっていた。
    // 監視が取りこぼしたぶんは、押せば必ず合わせられる
    let upkeep = SubmenuBuilder::new(handle, "手入れ")
        .item(&item("resync", "最新の情報に同期", None)?)
        .item(&item("rebuild-index", "索引を作り直す", None)?)
        .item(&item(
            "cleanup-attachments",
            "使っていない添付を片づける…",
            None,
        )?)
        .item(&item("llm-unload", "モデルを降ろす", None)?)
        .build()?;

    // 書き出しと読み込みは**形式を 2 階層目に畳む**（要望 2026-09-13）。
    // 形式が増えるたびに「ファイル」が伸びて、日々使う項目（新規・保存）が
    // 沈んでいた
    let export = SubmenuBuilder::new(handle, "エクスポート")
        .item(&item("export-html", "HTML…", None)?)
        .item(&item("export-pptx", "PowerPoint…", None)?)
        .item(&item("export-docx", "Word…", None)?)
        // PDF は印刷と同じ道（ADR-0038）。**項目を分けて置く** — 印刷の窓の
        // 中にあると気づかれない（差分の調べ 2026-09-06）
        .item(&item("export-pdf", "PDF…", None)?)
        .build()?;
    // 読み込みも形式ごとに分ける。**選ぶ窓の絞り込みが形式ごとに効く**ので、
    // 「PDF を読み込む」と決めてから探せる
    let import = SubmenuBuilder::new(handle, "インポート")
        .item(&item("import-pdf", "PDF…", None)?)
        .item(&item("import-pptx", "PowerPoint…", None)?)
        .item(&item(
            "import-image",
            "画像（PNG・JPEG・HEIC・TIFF）…",
            None,
        )?)
        .build()?;

    let file = SubmenuBuilder::new(handle, "ファイル")
        .item(&item("new-note", "新規ノート", Some("CmdOrCtrl+N"))?)
        .item(&item(
            "new-from-template",
            "テンプレートから新規…",
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&item("daily-note", "今日のノート", Some("CmdOrCtrl+T"))?)
        // 昨日・先週のぶんへ戻れるように（7-5。ポメラの日付メモ相当）
        .item(&item("pick-day", "日付を選んで開く…", None)?)
        .item(&item("move-note", "フォルダへ移動…", None)?)
        .item(&item("open-vault", "保管フォルダを開く…", None)?)
        .separator()
        .item(&upkeep)
        .separator()
        .item(&item("save", "保存", Some("CmdOrCtrl+S"))?)
        .item(&export)
        .item(&import)
        // 印刷（ADR-0038）。macOS の印刷パネルから「PDF として保存」もできる
        .item(&item("print", "プリント…", Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item("history", "版の履歴…", None)?)
        .item(&item("trash", "ゴミ箱へ移動", None)?)
        .build()?;
    let edit = SubmenuBuilder::new(handle, "編集")
        .item(&PredefinedMenuItem::undo(handle, Some(labels.undo))?)
        .item(&PredefinedMenuItem::redo(handle, Some(labels.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(handle, Some(labels.cut))?)
        .item(&PredefinedMenuItem::copy(handle, Some(labels.copy))?)
        .item(&PredefinedMenuItem::paste(handle, Some(labels.paste))?)
        .item(&PredefinedMenuItem::select_all(
            handle,
            Some(labels.select_all),
        )?)
        .separator()
        // 書式（B-1）。エディタのキー（Cmd+B 等）は横取りしないよう
        // アクセラレータを付けない
        .item(&item("format-heading", "見出し（段落⇄H1⇄H2⇄H3）", None)?)
        .item(&item("format-bullet", "箇条書き", None)?)
        .item(&item("format-ordered", "番号付きリスト", None)?)
        .item(&item("format-quote", "引用", None)?)
        .separator()
        .item(&item("insert-table", "表を挿入…", None)?)
        .separator()
        // 仮身化（M-1）。選んだところを別のノートにして、跡にリンクを残す
        .item(&item("extract", "選択範囲をノートに切り出す", None)?)
        .build()?;
    // 文字の大きさ（要望 2026-09-13 で畳んだ）。アクセラレータを付けない:
    // メニューのそれは US 配列の物理キーで解釈され、JIS では Cmd+= が別の
    // キーに化けた（実機報告）。ショートカットは WebView 側の keydown が担う
    let zoom = SubmenuBuilder::new(handle, "文字の大きさ")
        .item(&item("zoom-in", "大きく（Cmd+=）", None)?)
        .item(&item("zoom-out", "小さく（Cmd+-）", None)?)
        .item(&item("zoom-reset", "標準（Cmd+0）", None)?)
        .build()?;
    // 本文の見せ方の切り替え（要望 2026-09-13 で畳んだ）。ペインの開閉とは
    // 別の話なので、同じ並びに置かない
    let modes = SubmenuBuilder::new(handle, "書くときの見え方")
        .item(&toggle("source-mode", "ソースモード", Some("CmdOrCtrl+/"))?)
        .item(&toggle(
            "focus-mode",
            "フォーカスモード",
            Some("CmdOrCtrl+Shift+D"),
        )?)
        .item(&toggle(
            "typewriter",
            "タイプライタモード",
            Some("CmdOrCtrl+Shift+Y"),
        )?)
        .build()?;

    // 並びは**仲間ごと**（要望 2026-09-13）: 探す → ペイン → 見せ方 → 道具
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
        // 探す仲間。今までは文字サイズの後ろに離れていた
        .item(&item(
            "heading-palette",
            "見出しへ飛ぶ…",
            Some("CmdOrCtrl+R"),
        )?)
        // **入口が無かった**（2026-09-13 に気付いた）。受け口（save-search）は
        // あるのにメニューに項目が無く、保存した検索を作る道が塞がっていた
        .item(&item("save-search", "検索を保存…", None)?)
        .separator()
        // ペインの開閉（spec §5.1 / §5.4）
        .item(&toggle(
            "toggle-trees",
            "サイドバー（フォルダ・タグ）",
            Some("CmdOrCtrl+1"),
        )?)
        .item(&toggle("toggle-notes", "ノート一覧", Some("CmdOrCtrl+2"))?)
        .item(&toggle("outline", "アウトライン", Some("CmdOrCtrl+5"))?)
        .item(&toggle("assistant", "アシスタント", Some("CmdOrCtrl+6"))?)
        .separator()
        .item(&modes)
        .item(&zoom)
        .separator()
        // 別の角度からノートを見る道具
        // リンクの図（M-2）。起点は開いているノート
        .item(&item("link-graph", "リンクの図…", None)?)
        // 文体を見る（U-4）。**指摘するだけで直さない**
        .item(&item("style-check", "文体を見る…", None)?)
        .separator()
        // 標準のフルスクリーン（緑ボタンと同じ。2026-09-13 の見落とし確認）
        .item(&PredefinedMenuItem::fullscreen(
            handle,
            Some(labels.fullscreen),
        )?)
        .build()?;
    // ウインドウ（macOS の標準。2026-09-13 の見落とし確認で足した）。
    // **「閉じる」が無いと ⌘W が効かない** — 書き取りの小窓（ADR-0057）を
    // キーで閉じられなかった（Esc と Cmd+Enter では閉じられる）
    let window = SubmenuBuilder::new(handle, "ウインドウ")
        .item(&PredefinedMenuItem::minimize(
            handle,
            Some(labels.minimize),
        )?)
        .item(&PredefinedMenuItem::maximize(handle, Some(labels.zoom))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            handle,
            Some(labels.close_window),
        )?)
        .build()?;

    let help = SubmenuBuilder::new(handle, "ヘルプ")
        .item(&item("place-manual", "使い方のノートを置き直す", None)?)
        .item(&item(
            "place-mcp-manual",
            "Claude とつなぐ（MCP）の手引きを置く",
            None,
        )?)
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&application, &file, &edit, &view, &window, &help])
        .build()?;
    app.set_menu(menu)?;
    {
        use tauri::Manager;
        app.manage(checks);
    }
    app.on_menu_event(|app, event| {
        use tauri::Emitter;
        let _ = app.emit("menu", event.id().0.clone());
    });
    Ok(())
}

/// 印つきメニュー項目の控え（要望 2026-09-13）。
///
/// **状態を持つのは画面側**（T2）。こちらは「今こうなっている」と言われた
/// とおりに印を付け外しするだけで、自分では何も決めない。
#[derive(Default)]
pub struct MenuChecks {
    items:
        std::sync::Mutex<std::collections::HashMap<String, tauri::menu::CheckMenuItem<tauri::Wry>>>,
}

impl MenuChecks {
    fn remember(&self, id: &str, item: tauri::menu::CheckMenuItem<tauri::Wry>) {
        if let Ok(mut items) = self.items.lock() {
            items.insert(id.to_string(), item);
        }
    }

    /// 画面から届いた状態を印に写す。知らない id は黙って飛ばす
    /// （メニューから項目が消えても画面を落とさない）
    pub fn apply(&self, state: &std::collections::HashMap<String, bool>) {
        let Ok(items) = self.items.lock() else { return };
        for (id, checked) in state {
            if let Some(item) = items.get(id) {
                let _ = item.set_checked(*checked);
            }
        }
    }
}

/// 標準メニューの呼び名（macOS の日本語に合わせる。実機 2026-09-11: Tauri の
/// 既定は英語）。表に持つのは、テストで「英語のまま残っていない」を見るため
pub struct StandardLabels {
    pub about: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub quit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub services: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub close_window: &'static str,
    pub fullscreen: &'static str,
}

pub const STANDARD_LABELS: StandardLabels = StandardLabels {
    about: "おぼえがきについて",
    hide: "おぼえがきを隠す",
    hide_others: "ほかを隠す",
    show_all: "すべてを表示",
    quit: "おぼえがきを終了",
    undo: "取り消す",
    redo: "やり直す",
    cut: "カット",
    copy: "コピー",
    paste: "ペースト",
    select_all: "すべてを選択",
    services: "サービス",
    minimize: "しまう",
    zoom: "拡大／縮小",
    close_window: "閉じる",
    fullscreen: "フルスクリーンにする",
};

/// 「について」に出す版。Cargo の版と、`make app` が渡すビルド日時
/// （build.rs。渡されなければ「開発版」）
pub fn about_versions() -> (&'static str, &'static str) {
    (env!("CARGO_PKG_VERSION"), env!("OBOEGAKI_BUILD_TIME"))
}

/// 「について」の文字（要望 2026-09-10）。macOS の窓は
/// 「Version {version} ({short_version})」の順で組む — 名前から想像する逆
/// （実機で確認）。版を version、日時を short_version に置くと
/// 「Version 0.5.0 (2026-09-10 13:06)」になる
pub struct AboutLines {
    pub name: &'static str,
    pub version: &'static str,
    pub short_version: &'static str,
}

pub fn about_lines() -> AboutLines {
    let (version, stamp) = about_versions();
    AboutLines {
        name: "おぼえがき(OboeGaki)",
        version,
        short_version: stamp,
    }
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

    /// **ドラッグの横取りを切っておく。**
    ///
    /// wry の macOS 実装は drag&drop のハンドラが入っていると
    /// `draggingEntered` / `draggingUpdated` / `performDragOperation` を
    /// 横取りし、**ハンドラが受けたら WebKit へ渡さない**
    /// （wry 0.55.1 の wkwebview/drag_drop.rs）。Tauri 側のハンドラは
    /// 常に `true` を返す（tauri-runtime-wry 2.11.4 の lib.rs）ので、
    /// 入れたままだと画面の中の Drag & Drop が丸ごと死ぬ:
    /// 掴めるのにどこにも落とせない（実機で発覚 2026-09-04）。
    ///
    /// 切ると WebKit が自前で捌くので、画面の中の落下も、Finder からの
    /// 画像の落とし込み（`dataTransfer.files` を editor/attachments が
    /// 読む）も生きる。
    /// 「おぼえがきについて」に出す絵（要望 2026-09-04）。
    ///
    /// 束ねる前（`cargo tauri dev`）は .app の中に居ないので、OS には
    /// アプリの絵が分からず、書類フォルダの絵が出る。**こちらから渡す。**
    #[test]
    fn test_aboutに渡す絵が読める() {
        let image = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"));
        assert!(image.is_ok());
    }

    /// 「について」の窓は白いので、紙の縁が白に溶けると絵の境が消える
    /// （実機 2026-09-10）。紙の縁のすぐ内側は白より明らかに暗いこと
    #[test]
    fn test_aboutの絵は白い地の上でも縁が見える() {
        let image = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
            .expect("PNG が読める");
        let (width, height) = (image.width() as usize, image.height() as usize);
        let rgba = image.rgba();
        // 左端の紙の縁（inset 6% のすぐ内側）を中央の高さで見る
        let x = (width as f64 * 0.068) as usize;
        let y = height / 2;
        let at = (y * width + x) * 4;
        let (r, g, b, a) = (rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]);
        assert!(a > 200, "縁が透けている: a={a}");
        let luminance = (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64) / 255.0;
        assert!(
            luminance < 0.9,
            "縁が白に溶ける: rgb=({r},{g},{b}) L={luminance:.3}"
        );
    }

    /// 「について」の 2 行（実機 2026-09-10）:
    ///   おぼえがき(OboeGaki)
    ///   Version 0.5.x (2026-09-10 13:06)
    /// macOS は「Version {version} ({short_version})」の順で組む（実機で確認。
    /// 名前から想像する逆）ので、版を version、日時を short_version に置く
    #[test]
    fn test_aboutの2行_名前と_版と括弧のビルド日時() {
        let about = super::about_lines();
        assert_eq!(about.name, "おぼえがき(OboeGaki)");
        assert_eq!(about.version, super::about_versions().0); // 値は固定しない（make bump）
        assert_eq!(about.short_version, super::about_versions().1);
    }

    /// 標準メニューは英語のまま残さない（実機 2026-09-11）。日本語対応の
    /// 宣言（Info.plist）と ja.lproj もここで見張る
    #[test]
    fn test_標準メニューの呼び名は日本語_日本語対応を宣言している() {
        let l = &super::STANDARD_LABELS;
        for label in [
            l.about,
            l.hide,
            l.hide_others,
            l.show_all,
            l.quit,
            l.undo,
            l.redo,
            l.cut,
            l.copy,
            l.paste,
            l.select_all,
            l.services,
            l.minimize,
            l.zoom,
            l.close_window,
            l.fullscreen,
        ] {
            assert!(!label.is_ascii(), "英語のまま: {label}");
        }
        let plist = include_str!("../Info.plist");
        assert!(plist.contains("<string>ja</string>"));
        assert!(plist.contains("CFBundleAllowMixedLocalizations"));
        assert!(include_str!("../locales/ja.lproj/InfoPlist.strings").contains("おぼえがき"));
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(conf["bundle"]["resources"]
            .as_object()
            .map(|m| m
                .values()
                .any(|v| v.as_str() == Some("ja.lproj/InfoPlist.strings")))
            .unwrap_or(false));
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
