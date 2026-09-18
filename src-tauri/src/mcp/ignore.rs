// 見せない場所（`.mcp-ignore`）。行ごとのフォルダ・ノート、コメントと空行。
// GUI の「Claude に渡さない」もここを読み書きする

use crate::vault::SKIP_DIRS;
use std::path::Path;

// MCP サーバの中核（ADR-0051、TASKS 第 10 群）。バイナリ（bin/mcp.rs）は
// rmcp との橋渡しだけで、答えの中身はここが作る（T3: ヘッドレスに試せる）。
//
// - 索引は**読む**。アプリが動いていれば索引はアプリが育てている。動いて
//   いなければ問い合わせの前に差分同期を自分で走らせる（2 つのプロセスが
//   同時に SQLite へ書かない約束）
// - `.mcp-ignore`（保管フォルダ直下、1 行 1 フォルダ）の中は見せない。
//   `.trash` / `templates` / 管理フォルダは既定で見せない

/// `.mcp-ignore` の置き場（保管フォルダ直下）
pub const IGNORE_FILE: &str = ".mcp-ignore";

/// 置いておく `.mcp-ignore` の中身（保管フォルダを作るときに 1 度だけ）。
/// **説明だけで、何も隠さない。** 隠すのは人が決めること — 勝手に決めない
pub const DEFAULT_IGNORE: &str = "\
# ここに書いたフォルダ・ノートは、Claude（MCP）から見えません。
# 1 行に 1 つ、保管フォルダからの道を書きます。
#
#   プライベート
#   仕事/評価
#   秘密のメモ.md
#
# サイドバーやノートの右クリック →「Claude に渡さない」でも切り替えられます。
# ゴミ箱・雛形・管理フォルダは、書かなくても最初から見えません。
";

/// `.mcp-ignore` が無ければ置く（**上書きはしない**）。保管フォルダを
/// 開くたびに通るので、消した人のところに空のまま戻ることはある
pub fn ensure_ignore_file(root: &Path) -> std::io::Result<()> {
    let path = root.join(IGNORE_FILE);
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, DEFAULT_IGNORE)
}

/// 画面に渡す「見せない場所」。**最初から見せない場所も一緒に渡す** —
/// 画面側で並べ直すと、こちらの `SKIP_DIRS` が増えたときに黙って食い違う
/// （レビュー 2026-09-13）
#[derive(Debug, Clone, serde::Serialize)]
pub struct Hidden {
    /// `.mcp-ignore` に書いてある道（人が決めたもの）
    pub listed: Vec<String>,
    /// 書かなくても見せない場所（ゴミ箱・雛形・管理フォルダ・添付）
    pub builtin: Vec<String>,
}

/// いま隠しているものの一覧。画面の印に使う
pub fn hidden_list(root: &Path) -> Hidden {
    Hidden {
        listed: IgnoreList::load(root).folders,
        builtin: SKIP_DIRS.iter().map(|name| name.to_string()).collect(),
    }
}

/// 1 つを隠す / 隠すのをやめる（GUI から。ピン留めと同じ手触り）。
///
/// **人が書いた行は消さない** — コメントも、他の行も、並びもそのまま。
/// 触るのは名指しされた 1 行だけ
pub fn set_hidden(root: &Path, relative: &str, hidden: bool) -> std::io::Result<()> {
    let cleaned = relative.trim().trim_matches('/');
    if cleaned.is_empty() || cleaned.split('/').any(|part| part == ".." || part == ".") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("保管フォルダの中の道ではありません: {relative}"),
        ));
    }
    let path = root.join(IGNORE_FILE);
    let current = std::fs::read_to_string(&path).unwrap_or_else(|_| DEFAULT_IGNORE.to_string());
    let mut lines: Vec<String> = current.lines().map(str::to_string).collect();
    let listed = |line: &str| line.trim().trim_matches('/') == cleaned;
    if hidden {
        if !lines.iter().any(|line| listed(line)) {
            lines.push(cleaned.to_string());
        }
    } else {
        lines.retain(|line| !listed(line));
    }
    let mut text = lines.join("\n");
    text.push('\n');
    std::fs::write(path, text)
}

/// GUI から来た道を `.mcp-ignore` に書く形（保管フォルダからの相対）に直す。
/// ノートは絶対パス、フォルダは相対で来る。**外の絶対パスは断る** —
/// 剥がせないまま `Users/…/x.md` を書くと、何も隠れないのに画面は
/// 「渡さない」になる（レビュー 2026-09-14）。綴りが違っても実体が同じなら
/// 中と見る（`/private/var` ↔ `/var`、シンボリックリンク）
pub fn hidden_relative(root: &Path, path: &str) -> Result<String, String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Ok(path.trim_matches('/').to_string());
    }
    let outside = || format!("保管フォルダの外です: {path}");
    if let Ok(rest) = candidate.strip_prefix(root) {
        return Ok(rest.to_string_lossy().trim_matches('/').to_string());
    }
    let real_root = root.canonicalize().map_err(|_| outside())?;
    let real = candidate.canonicalize().map_err(|_| outside())?;
    let rest = real.strip_prefix(&real_root).map_err(|_| outside())?;
    Ok(rest.to_string_lossy().trim_matches('/').to_string())
}

/// 見せないフォルダの一覧。`.mcp-ignore` の各行（`#` から始まる行と空行は
/// 飛ばす）と、一覧に出ないもの（`.trash` / `templates` / 管理フォルダ）
#[derive(Debug, Clone, Default)]
pub struct IgnoreList {
    folders: Vec<String>,
}

impl IgnoreList {
    pub fn load(root: &Path) -> Self {
        // NFC に寄せて持つ。Finder が作ったフォルダ名は分解形（NFD）で来る
        // ことがあり、手で書いた行と字面が合わなくなる（レビュー 2026-09-14）
        let folders = std::fs::read_to_string(root.join(IGNORE_FILE))
            .unwrap_or_default()
            .lines()
            .map(|line| crate::vault::nfc_string(line.trim().trim_matches('/')))
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
        Self { folders }
    }

    /// vault からの相対パスがその中か。**区切りで見る**（`秘密` は `秘密2` を
    /// 隠さない）。既定で見せないフォルダは先頭の成分で見る。ドットで始まる
    /// 成分は**どの階層でも**見せない — `scan()` が各階層でドットフォルダを
    /// 飛ばすのと揃える（アプリに一切出ないものを MCP だけが読まない）
    pub fn is_ignored(&self, relative: &str) -> bool {
        let relative = crate::vault::nfc_string(relative);
        let first = relative.split('/').next().unwrap_or("");
        if SKIP_DIRS.contains(&first) || relative.split('/').any(|part| part.starts_with('.')) {
            return true;
        }
        self.folders
            .iter()
            .any(|folder| relative == *folder || relative.starts_with(&format!("{folder}/")))
    }
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use unicode_normalization::UnicodeNormalization;

    #[test]
    fn test_ignore_list_行ごとのフォルダ_コメントと空行_区切りで見る() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join(".mcp-ignore"),
            "# 見せない\n秘密\n\n仕事/私用\n",
        )
        .unwrap();
        let ignore = IgnoreList::load(root.path());
        assert!(ignore.is_ignored("秘密/a.md"));
        assert!(ignore.is_ignored("仕事/私用/b.md"));
        assert!(!ignore.is_ignored("秘密2/a.md")); // 前方一致ではない
        assert!(!ignore.is_ignored("仕事/a.md"));
        // 既定で見せないもの
        assert!(ignore.is_ignored(".trash/a.md"));
        assert!(ignore.is_ignored("templates/雛形.md"));
        // 無ければ既定だけ
        let none = IgnoreList::load(TempDir::new().unwrap().path());
        assert!(!none.is_ignored("秘密/a.md"));
    }

    #[test]
    fn test_is_ignored_途中のドットフォルダも隠し_NFCで照合する() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join(".mcp-ignore"), "プライベート\n").unwrap();
        let ignore = IgnoreList::load(root.path());
        // `scan()` はどの階層でもドットフォルダを飛ばす。MCP も同じ
        assert!(ignore.is_ignored("仕事/.secret/x.md"));
        // Finder が作ったフォルダ名は分解形（NFD）で来ることがある
        let nfd: String = "プライベート/日記.md".nfd().collect();
        assert_ne!(nfd, "プライベート/日記.md");
        assert!(ignore.is_ignored(&nfd));
    }

    #[test]
    fn test_hidden_relative_絶対パスは保管フォルダの中だけ_相対はそのまま() {
        let root = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("仕事")).unwrap();
        fs::write(root.path().join("仕事/a.md"), "# a\n").unwrap();
        let inside = root.path().join("仕事/a.md");
        assert_eq!(
            hidden_relative(root.path(), inside.to_str().unwrap()).unwrap(),
            "仕事/a.md"
        );
        assert_eq!(hidden_relative(root.path(), "仕事").unwrap(), "仕事");
        // 綴りが違っても実体が同じなら中（/private/var ↔ /var、シンボリックリンク）
        let alias = TempDir::new().unwrap();
        let link = alias.path().join("link");
        std::os::unix::fs::symlink(root.path(), &link).unwrap();
        let via_link = link.join("仕事/a.md");
        assert_eq!(
            hidden_relative(root.path(), via_link.to_str().unwrap()).unwrap(),
            "仕事/a.md"
        );
        // 外の絶対パスは断る（`Users/…/x.md` を書いて何も隠れないのが最悪）
        assert!(hidden_relative(root.path(), "/tmp/x.md").is_err());
    }

    #[test]
    fn test_ignore_list_共有の見本と同じ答えを出す() {
        // fixtures/mcp-ignore-cases.json は TS 側（mcp-hidden.isHiddenFromMcp）と同じ見本
        let raw = include_str!("../../../fixtures/mcp-ignore-cases.json");
        let found: serde_json::Value = serde_json::from_str(raw).unwrap();
        for case in found["cases"].as_array().unwrap() {
            let root = TempDir::new().unwrap();
            fs::write(
                root.path().join(IGNORE_FILE),
                case["ignore"].as_str().unwrap(),
            )
            .unwrap();
            let ignore = IgnoreList::load(root.path());
            let relative = case["relative"].as_str().unwrap();
            let want = case["hidden"].as_bool().unwrap();
            // 空（保管フォルダそのもの）は TS 側の判定。Rust の guarded は先に断る
            if relative.is_empty() {
                continue;
            }
            assert_eq!(ignore.is_ignored(relative), want, "見本: {relative:?}");
        }
    }

    #[test]
    fn test_ensure_ignore_file_無ければ作る_あるものには触らない() {
        let root = TempDir::new().unwrap();
        ensure_ignore_file(root.path()).unwrap();
        let path = root.path().join(IGNORE_FILE);
        let text = fs::read_to_string(&path).unwrap();
        // 置くだけでは**何も隠れない**（説明だけの中身）
        assert!(IgnoreList::load(root.path()).folders.is_empty());
        assert!(text.contains("Claude"));

        fs::write(&path, "秘密\n").unwrap();
        ensure_ignore_file(root.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "秘密\n");
    }

    #[test]
    fn test_set_hidden_足す_外す_コメントと他の行を残す() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join(IGNORE_FILE),
            "# 見せない場所\n\n仕事/評価\n",
        )
        .unwrap();

        set_hidden(root.path(), "プライベート", true).unwrap();
        let text = fs::read_to_string(root.path().join(IGNORE_FILE)).unwrap();
        assert!(text.starts_with("# 見せない場所\n"), "{text:?}");
        assert!(text.contains("仕事/評価\n"));
        assert!(text.contains("プライベート\n"));
        assert_eq!(
            hidden_list(root.path()).listed,
            ["仕事/評価", "プライベート"]
        );

        // 二度足しても増えない
        set_hidden(root.path(), "プライベート", true).unwrap();
        assert_eq!(hidden_list(root.path()).listed.len(), 2);

        set_hidden(root.path(), "仕事/評価", false).unwrap();
        assert_eq!(hidden_list(root.path()).listed, ["プライベート"]);
        // コメントは残る（人が書いたものを消さない）
        assert!(fs::read_to_string(root.path().join(IGNORE_FILE))
            .unwrap()
            .contains("# 見せない場所"));

        // 保管フォルダの外と空は断る
        assert!(set_hidden(root.path(), "../外", true).is_err());
        assert!(set_hidden(root.path(), "  ", true).is_err());
        // ファイルが無ければ作ってから足す
        let fresh = TempDir::new().unwrap();
        set_hidden(fresh.path(), "秘密", true).unwrap();
        assert_eq!(hidden_list(fresh.path()).listed, ["秘密"]);
    }
}
