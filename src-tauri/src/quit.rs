// 終了の求めの受け方（25-2）。メニューの「終了」（Cmd+Q）も OS からの求め（Dock の
// 「終了」・ログアウト・AppleScript の quit）も、**画面に打ちかけを書き切らせてから**
// 終える。画面が応えなければ時間を切って終える — 終われないアプリにしない。
//
// 判断（誰が求めたか・待つか・もう答えたか）はここで純 Rust に持ち、cargo test で
// 確かめる。macOS の問い合わせ（applicationShouldTerminate:）との繋ぎは
// `macos` の中に薄く置く。

use std::sync::Mutex;
use std::time::Duration;

/// 画面が書き切るのを待つ長さ。過ぎたら書き切りを待たずに終える
pub const QUIT_TIMEOUT: Duration = Duration::from_secs(5);

/// 誰が終了を求めたか。答え方が違う
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// メニューの「終了」。`app.exit` で終える
    Menu,
    /// OS からの求め。「あとで答える」を返してあるので、終えてよいと**答える**
    System,
}

/// 終了の求めを受けたときの動き
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// 画面に書き切らせる。`generation` は時間切れの見張りが使う
    AskFrontend { generation: u64 },
    /// もう画面に頼んである。重ねて頼まない
    AlreadyAsking,
    /// 書き切るものも受け手も無い。すぐ終える
    ExitNow,
}

#[derive(Default)]
struct State {
    pending: Option<(Source, u64)>,
    generation: u64,
}

#[derive(Default)]
pub struct QuitGuard {
    state: Mutex<State>,
}

impl QuitGuard {
    pub const fn new() -> Self {
        Self {
            state: Mutex::new(State {
                pending: None,
                generation: 0,
            }),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        // 毒化していても終了は止めない
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// 終了を求められた。`main_open` は本文の窓があるか（受け手がいるか）
    pub fn request(&self, source: Source, main_open: bool) -> Decision {
        let mut state = self.state();
        if let Some((pending, generation)) = state.pending {
            // メニューの終了を待っている間に OS からも求められたら、OS に答える側へ
            // 切り替える（「あとで答える」を返したぶん、答えないと OS が待ち続ける）
            if source == Source::System && pending == Source::Menu {
                state.pending = Some((Source::System, generation));
            }
            return Decision::AlreadyAsking;
        }
        if !main_open {
            return Decision::ExitNow;
        }
        state.generation += 1;
        let generation = state.generation;
        state.pending = Some((source, generation));
        Decision::AskFrontend { generation }
    }

    /// 画面が書き切った（`app_exit`）。どう終えるかを返す。頼んでいなければ
    /// `None`（そのまま `app.exit` で終えてよい）
    pub fn finish(&self) -> Option<Source> {
        self.state().pending.take().map(|(source, _)| source)
    }

    /// 時間切れ。頼んだときの `generation` がまだ待っているときだけ終え方を返す
    /// （画面が先に書き切っていたら何もしない）
    pub fn timed_out(&self, generation: u64) -> Option<Source> {
        let mut state = self.state();
        match state.pending {
            Some((source, waiting)) if waiting == generation => {
                state.pending = None;
                Some(source)
            }
            _ => None,
        }
    }
}

/// アプリに 1 つの見張り
pub static QUIT: QuitGuard = QuitGuard::new();

/// 終了の求めの入口（メニューの「終了」と OS の問い合わせ）。画面に頼むときは、
/// 時間切れの見張りも立てる
pub fn request_quit(app: &tauri::AppHandle, source: Source) -> Decision {
    use tauri::{Emitter, Manager};
    let main_open = app.get_webview_window("main").is_some();
    let decision = QUIT.request(source, main_open);
    if let Decision::AskFrontend { generation } = decision {
        let _ = app.emit("menu", "app-quit");
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(QUIT_TIMEOUT);
            if let Some(source) = QUIT.timed_out(generation) {
                eprintln!(
                    "画面が {} 秒のうちに書き切らなかったので、待たずに終える",
                    QUIT_TIMEOUT.as_secs()
                );
                leave(&app, source);
            }
        });
    }
    decision
}

/// 画面が書き切った（`app_exit`）。頼まれていなければそのまま終える
pub fn frontend_done(app: &tauri::AppHandle) {
    match QUIT.finish() {
        Some(source) => leave(app, source),
        None => app.exit(0),
    }
}

fn leave(app: &tauri::AppHandle, source: Source) {
    match source {
        Source::Menu => app.exit(0),
        Source::System => macos::reply_terminate(app),
    }
}

/// OS の問い合わせを受け始める（setup から 1 度呼ぶ）
pub fn install(app: &tauri::AppHandle) {
    macos::install(app);
}

/// macOS の「終了してよいか」（applicationShouldTerminate:）との繋ぎ。
///
/// tao（0.35）のアプリの delegate はこの問い合わせを持たず、Dock の「終了」や
/// ログアウトはいきなり終わった（applicationWillTerminate: は止められない）。
/// **実行時に delegate の型へ足す**。tao が将来自分で持ったら足さない（今までどおり）。
/// 「あとで答える」を返して画面に書き切らせ、書き終えたら「終えてよい」と答える
/// （「取り消す」を返すとログアウトまで止めてしまう）。tao 自身の終え方
/// （`app.exit` → `[NSApp stop:]`）はこの問い合わせを通らないので、二重には止まらない
#[cfg(target_os = "macos")]
mod macos {
    use super::{request_quit, Decision, Source};
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, ffi, msg_send, sel};
    use std::sync::OnceLock;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    /// NSApplicationTerminateReply
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    pub fn install(app: &tauri::AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // SAFETY: 主スレッド（setup）から、NSApplication の既存の delegate の型に
        // メソッドを 1 つ足すだけ。型の符号（Q@:@）は NSUInteger を返し id を受ける形
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                eprintln!("アプリの delegate が無いので、OS からの終了は止められない");
                return;
            }
            let class = ffi::object_getClass(delegate) as *mut AnyClass;
            let selector = sel!(applicationShouldTerminate:);
            if ffi::class_respondsToSelector(class, selector).as_bool() {
                return; // 土台が自分で受けている。手を出さない
            }
            let method: extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize =
                should_terminate;
            let imp: Imp = std::mem::transmute::<
                extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(method);
            if !ffi::class_addMethod(class, selector, imp, c"Q@:@".as_ptr()).as_bool() {
                eprintln!("終了の問い合わせの受け口を足せなかった");
            }
        }
    }

    extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _selector: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        match request_quit(app, Source::System) {
            Decision::ExitNow => TERMINATE_NOW,
            Decision::AskFrontend { .. } | Decision::AlreadyAsking => TERMINATE_LATER,
        }
    }

    /// 「終えてよい」と答える。答えは主スレッドから
    pub fn reply_terminate(app: &tauri::AppHandle) {
        let _ = app.run_on_main_thread(|| {
            // SAFETY: 主スレッドで NSApp に答えを送るだけ
            unsafe {
                let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let () = msg_send![ns_app, replyToApplicationShouldTerminate: Bool::YES];
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn install(_app: &tauri::AppHandle) {}
    pub fn reply_terminate(app: &tauri::AppHandle) {
        app.exit(0);
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_本文の窓があれば画面に書き切らせる() {
        let guard = QuitGuard::new();
        assert!(matches!(
            guard.request(Source::System, true),
            Decision::AskFrontend { .. }
        ));
        assert_eq!(guard.finish(), Some(Source::System));
    }

    #[test]
    fn test_本文の窓が無ければすぐ終える() {
        let guard = QuitGuard::new();
        assert_eq!(guard.request(Source::Menu, false), Decision::ExitNow);
        assert_eq!(guard.finish(), None);
    }

    #[test]
    fn test_待っている間の求めは重ねて頼まない() {
        let guard = QuitGuard::new();
        guard.request(Source::Menu, true);
        assert_eq!(guard.request(Source::Menu, true), Decision::AlreadyAsking);
        assert_eq!(guard.finish(), Some(Source::Menu));
    }

    #[test]
    fn test_メニューの終了を待つ間に_OS_からも求められたら_OS_に答える() {
        // 「あとで答える」を返したぶん、答えないとログアウトが止まったままになる
        let guard = QuitGuard::new();
        guard.request(Source::Menu, true);
        assert_eq!(guard.request(Source::System, true), Decision::AlreadyAsking);
        assert_eq!(guard.finish(), Some(Source::System));
    }

    #[test]
    fn test_画面が応えなければ時間切れで終える() {
        let guard = QuitGuard::new();
        let Decision::AskFrontend { generation } = guard.request(Source::Menu, true) else {
            panic!("画面に頼むはず");
        };
        assert_eq!(guard.timed_out(generation), Some(Source::Menu));
        // 時間切れのあとに画面が書き切っても、二度は終えない
        assert_eq!(guard.finish(), None);
    }

    #[test]
    fn test_画面が先に書き切っていたら時間切れは何もしない() {
        let guard = QuitGuard::new();
        let Decision::AskFrontend { generation } = guard.request(Source::Menu, true) else {
            panic!("画面に頼むはず");
        };
        assert_eq!(guard.finish(), Some(Source::Menu));
        assert_eq!(guard.timed_out(generation), None);
    }

    #[test]
    fn test_古い頼みの時間切れは新しい頼みを終えない() {
        let guard = QuitGuard::new();
        let Decision::AskFrontend { generation: old } = guard.request(Source::Menu, true) else {
            panic!("画面に頼むはず");
        };
        guard.finish();
        guard.request(Source::System, true);
        assert_eq!(guard.timed_out(old), None);
        assert_eq!(guard.finish(), Some(Source::System));
    }
}
