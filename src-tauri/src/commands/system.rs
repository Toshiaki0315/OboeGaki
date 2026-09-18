// OS へ渡す: Finder で開く・生成 AI のアプリ／URL へ手渡す（渡せる先は決め打ち）。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{guarded, CmdResult};
use std::path::PathBuf;

/// Finder で開いてよい場所か（保管フォルダの中の**フォルダ**だけ）。判断を
/// `open` から分けて headless で試せるようにした（棚卸し 2026-09-17: 以前の
/// テストは実在しないパスで canonicalize が失敗しているだけで通っていた）
pub fn finder_target(root: &str, path: &str) -> CmdResult<PathBuf> {
    let target = guarded(root, path)?;
    if !target.is_dir() {
        return Err("フォルダではありません".into());
    }
    Ok(target)
}

/// 選んだ文字を渡す先のアプリを開く（要望 2026-09-05）。
///
/// **渡せる先は決め打ち。** 受け取った名前をそのまま `open -a` へ流すと、
/// 画面側の穴がそのまま「好きなアプリを起動できる」になる。並びは
/// `src/lib/handoff.ts` と揃える（片方だけ増やさない）。
#[tauri::command]
pub fn open_handoff_app(app: String) -> CmdResult<()> {
    if !HANDOFF_APPS.contains(&app.as_str()) {
        return Err(format!("渡せない先です: {app}").into());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .args(["-a", &app])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        // 入っていないアプリを選んだとき。**押してから断る**しかない
        // （入っているかどうかは、押すまで分からない）
        Err(format!("{app} を開けませんでした（入っていますか？）").into())
    }
}

/// 開いてよいアプリ。`src/lib/handoff.ts` の並びと同じもの。
const HANDOFF_APPS: [&str; 4] = ["Claude", "Gemini", "ChatGPT", "Copilot"];

/// フォルダを Finder で開く（要望 2026-09-05）。
///
/// **保管フォルダの中だけ。** 画面から来たパスをそのまま開くと、どこでも
/// 開けてしまう（`guarded` が vault の外を断る）。
#[tauri::command]
pub fn open_in_finder(root: String, path: String) -> CmdResult<()> {
    let target = finder_target(&root, &path)?;
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&target)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err("Finder で開けませんでした".into())
    }
}

/// 文字ごと渡してよい URL の頭。**ここも決め打ち** — 画面から来た URL を
/// そのまま開くと、`file://` でも何でも開けてしまう。
const HANDOFF_URLS: [&str; 2] = ["claude://claude.ai/new?q=", "dict://"];

/// 文字ごと渡す（貼り付けが要らないアプリ用。要望 2026-09-05）。
///
/// Claude は URL に文字を載せて渡せる（アプリの中に `q` を読む口がある。
/// 実物で確認）。載せられない長さのものは画面側がクリップボードに倒す。
#[tauri::command]
pub fn open_handoff_url(url: String) -> CmdResult<()> {
    if !HANDOFF_URLS.iter().any(|head| url.starts_with(head)) {
        return Err("渡せない URL です".into());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err("渡せませんでした（アプリが入っていますか？）".into())
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_Finder_で開けるのは保管フォルダの中のフォルダだけ() {
        // 以前は実在しないパスで canonicalize が失敗しているだけで通っていた
        // （封じ込めの規則を壊しても緑。棚卸し 2026-09-17）。実物で見る
        let root = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("仕事")).unwrap();
        std::fs::write(root.path().join("仕事/a.md"), "# a\n").unwrap();
        let root_str = root.path().to_str().unwrap();
        let folder = root.path().join("仕事");
        assert_eq!(
            finder_target(root_str, folder.to_str().unwrap()).unwrap(),
            folder.canonicalize().unwrap()
        );
        let file = root.path().join("仕事/a.md");
        assert_eq!(
            finder_target(root_str, file.to_str().unwrap()).unwrap_err(),
            "フォルダではありません"
        );
        assert!(finder_target(root_str, "/etc").is_err());
        assert!(finder_target(root_str, "/v/other/x").is_err());
    }

    #[test]
    fn test_渡せる_URL_も決め打ち() {
        // 画面から来た URL をそのまま開かない（file:// でも開けてしまう）
        assert!(open_handoff_url("file:///etc/passwd".into()).is_err());
        assert!(open_handoff_url("https://example.com".into()).is_err());
        assert!(HANDOFF_URLS[0].starts_with("claude://"));
    }

    #[test]
    fn test_渡せる先は決め打ち() {
        // 画面から来た名前をそのまま開かない（好きなアプリを起動させない）
        assert!(open_handoff_app("Terminal".into()).is_err());
        assert!(open_handoff_app("../../bin/sh".into()).is_err());
        assert!(HANDOFF_APPS.contains(&"Claude"));
    }
}
