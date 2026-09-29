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
    // 途中で落ちて空のファイルが残ると、隠していた場所が全部見える（fail-open）。
    // 本文と同じくアトミックに書く（レビュー 2026-09-24 / 21-3）
    crate::autosave::save_atomic(&path, DEFAULT_IGNORE)
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
    // 読めないときは書かない — 既定の中身から作り直して上書きすると、人が書いた行が
    // 全部消えた（24-2）。無いときだけ既定の中身から始める
    let current = read_ignore(&path)?.unwrap_or_else(|| DEFAULT_IGNORE.to_string());
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
    crate::autosave::save_atomic(&path, &text)
}

/// 隠したノート・フォルダが動いた（改名・移動）。`.mcp-ignore` の該当する行を動いた
/// 先へ書き換える（24-2）。書き換えたら `true`。
///
/// 以前は行が古い名前のまま残り、隠したノートの見出しを直すだけで（見出しに合わせた
/// 自動の改名）隠しが外れ、MCP から読み書きできた。照合は `is_ignored` と同じ規則
/// （NFC・成分の前後の空白・大文字小文字）。名指しの行も、その中を指す行も書き換える。
/// **ほかの行・コメント・並びはそのまま**（`set_hidden` と同じ構え）
pub fn follow_move(root: &Path, from: &str, to: &str) -> std::io::Result<bool> {
    let path = root.join(IGNORE_FILE);
    let Some(current) = read_ignore(&path)? else {
        return Ok(false);
    };
    let from_key = match_key(from.trim_matches('/'));
    let to = to.trim_matches('/');
    let depth = from_key.split('/').count();
    let mut changed = false;
    let lines: Vec<String> = current
        .lines()
        .map(|line| {
            let entry = line.trim().trim_matches('/');
            if entry.is_empty() || entry.starts_with('#') {
                return line.to_string();
            }
            let key = match_key(entry);
            if key == from_key {
                changed = true;
                return to.to_string();
            }
            if key.starts_with(&format!("{from_key}/")) {
                changed = true;
                let rest: Vec<&str> = entry.split('/').skip(depth).collect();
                return format!("{to}/{}", rest.join("/"));
            }
            line.to_string()
        })
        .collect();
    if !changed {
        return Ok(false);
    }
    let mut text = lines.join("\n");
    text.push('\n');
    crate::autosave::save_atomic(&path, &text)?;
    Ok(true)
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

/// 照合に使う字面: NFC・成分ごとに前後の空白を落とす・小文字（24-2）
fn match_key(path: &str) -> String {
    crate::vault::nfc_string(path)
        .split('/')
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("/")
        .to_lowercase()
}

/// 見せないフォルダの一覧。`.mcp-ignore` の各行（`#` から始まる行と空行は
/// 飛ばす）と、一覧に出ないもの（`.trash` / `templates` / 管理フォルダ）
#[derive(Debug, Clone, Default)]
pub struct IgnoreList {
    folders: Vec<String>,
    /// `.mcp-ignore` があるのに読めなかった。何を隠していたか分からないので、
    /// **全部を見せない**（開いたまま見せると、隠していたものが全部見える）
    unreadable: bool,
}

/// `.mcp-ignore` を読む。無ければ `None`。**本文と同じ読み方**（BOM を落とし、
/// UTF-8 で読めなければ Shift_JIS も受ける）— 手で書くファイルなので、以前の
/// `read_to_string` では BOM で 1 行目が効かず、Shift_JIS では読めずに全部見えた（24-2）
fn read_ignore(path: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(crate::vault::decode_text(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

impl IgnoreList {
    pub fn load(root: &Path) -> Self {
        let text = match read_ignore(&root.join(IGNORE_FILE)) {
            Ok(text) => text.unwrap_or_default(),
            Err(error) => {
                eprintln!(".mcp-ignore を読めないので、全部を見せない: {error}");
                return Self {
                    folders: Vec::new(),
                    unreadable: true,
                };
            }
        };
        // NFC に寄せて持つ。Finder が作ったフォルダ名は分解形（NFD）で来る
        // ことがあり、手で書いた行と字面が合わなくなる（レビュー 2026-09-14）
        let folders = text
            .lines()
            .map(|line| crate::vault::nfc_string(line.trim().trim_matches('/')))
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
        Self {
            folders,
            unreadable: false,
        }
    }

    /// vault からの相対パスがその中か。**区切りで見る**（`秘密` は `秘密2` を
    /// 隠さない）。既定で見せないフォルダは先頭の成分で見る。ドットで始まる
    /// 成分は**どの階層でも**見せない — `scan()` が各階層でドットフォルダを
    /// 飛ばすのと揃える（アプリに一切出ないものを MCP だけが読まない）
    ///
    /// **大文字小文字と、成分の前後の空白は区別しない**（24-2）。APFS は大文字小文字を
    /// 区別しないので `private/diary.md` で `Private/diary.md` が開け、MCP のフォルダ名
    /// は成分ごとに空白を落として使う（`existing_folder_relative`）ので ` Private` で
    /// `Private/` に書けた。字面そのままで比べていて、どちらも隠しをすり抜けた。
    /// 画面の `mcp-hidden.isHiddenFromMcp` も同じ規則（共有の見本が見張る）
    pub fn is_ignored(&self, relative: &str) -> bool {
        if self.unreadable {
            return true;
        }
        let relative = match_key(relative);
        let first = relative.split('/').next().unwrap_or("");
        if SKIP_DIRS.iter().any(|dir| dir.to_lowercase() == first)
            || relative.split('/').any(|part| part.starts_with('.'))
        {
            return true;
        }
        self.folders.iter().any(|folder| {
            let folder = match_key(folder);
            relative == folder || relative.starts_with(&format!("{folder}/"))
        })
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

    /// 手で書いた `.mcp-ignore` の文字コードで隠しが外れない（24-2）。以前は BOM で
    /// 1 行目が効かず、Shift_JIS では読めずに全部見えた
    #[test]
    fn test_ignore_list_BOM_や_Shift_JIS_で書いても隠す() {
        let root = TempDir::new().unwrap();
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice("Private\n".as_bytes());
        fs::write(root.path().join(IGNORE_FILE), bom).unwrap();
        assert!(IgnoreList::load(root.path()).is_ignored("Private/a.md"));

        // 「秘密」の Shift_JIS
        let sjis = [0x94, 0xE9, 0x96, 0xA7, b'\n'];
        fs::write(root.path().join(IGNORE_FILE), sjis).unwrap();
        assert!(IgnoreList::load(root.path()).is_ignored("秘密/a.md"));
    }

    /// 「隠す」で手書きの行を消さない（24-2）。以前は読めないと既定の中身から
    /// 作り直して上書きし、人が書いた行が全部消えた
    #[test]
    fn test_set_hidden_Shift_JIS_の行を残し_読めなければ上書きしない() {
        use std::os::unix::fs::PermissionsExt;
        let root = TempDir::new().unwrap();
        let path = root.path().join(IGNORE_FILE);
        fs::write(&path, [0x94, 0xE9, 0x96, 0xA7, b'\n']).unwrap(); // 秘密
        set_hidden(root.path(), "仕事", true).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("秘密") && text.contains("仕事"), "{text}");

        fs::write(&path, "手で書いた行\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let result = set_hidden(root.path(), "仕事", true);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(result.is_err(), "読めないのに書いた");
        assert_eq!(fs::read_to_string(&path).unwrap(), "手で書いた行\n");
    }

    /// 隠したノート・フォルダを動かしたら、行も動いた先へ書き換える（24-2）。以前は
    /// 古い名前のまま残り、見出しに合わせた自動の改名だけで隠しが外れた
    #[test]
    fn test_follow_move_隠した行を動いた先へ書き換え_ほかの行とコメントは残す() {
        let root = TempDir::new().unwrap();
        let path = root.path().join(IGNORE_FILE);
        fs::write(&path, "# 見せない\n日記.md\n私用\n私用/深い/x.md\n仕事\n").unwrap();
        assert!(follow_move(root.path(), "日記.md", "日記2.md").unwrap());
        assert!(follow_move(root.path(), "私用", "私用2").unwrap());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# 見せない\n日記2.md\n私用2\n私用2/深い/x.md\n仕事\n"
        );
        let ignore = IgnoreList::load(root.path());
        assert!(ignore.is_ignored("日記2.md"));
        assert!(ignore.is_ignored("私用2/a.md"));
        // 照合の規則は is_ignored と同じ（大文字小文字）
        fs::write(&path, "Private\n").unwrap();
        assert!(follow_move(root.path(), "private", "Secret").unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "Secret\n");
        // 隠していないものを動かしても触らない。ファイルが無くても困らない
        assert!(!follow_move(root.path(), "公開", "公開2").unwrap());
        fs::remove_file(&path).unwrap();
        assert!(!follow_move(root.path(), "日記.md", "日記3.md").unwrap());
        assert!(!path.exists());
    }

    /// アプリの改名・移動の 4 つの入口が、動かしたあとに行を書き換える（24-2）
    #[test]
    fn test_follow_move_改名と移動のコマンドがすべて呼ぶ() {
        let notes: String = include_str!("../commands/notes.rs")
            .split_whitespace()
            .collect();
        let folders: String = include_str!("../commands/folders.rs")
            .split_whitespace()
            .collect();
        for (source, name) in [
            (&notes, "pubfnnote_rename("),
            (&notes, "pubfnnote_move("),
            (&folders, "pubfnfolder_rename("),
            (&folders, "pubfnfolder_move("),
        ] {
            let start = source.find(name).unwrap_or_else(|| panic!("無い: {name}"));
            let body = &source[start..];
            let end = body[1..]
                .find("#[tauri::command]")
                .map_or(body.len(), |at| at + 1);
            assert!(
                body[..end].contains("follow_hidden("),
                "{name} が .mcp-ignore を追いかけていない"
            );
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
