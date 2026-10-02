// 版の履歴（ADR-0023）。参照実装 storage/history.py の移植。
//
// 保存のたびに全文を `.OboeGaki/history/<鍵のフォルダ>/<日時>.md` に残す。
// 差分にしない — 差分はそれ自体が壊れうる構造で、素の .md ならアプリが
// 無くても Finder から読める（T1 の精神）。
//
// 注意（ADR-0023 / CLAUDE.md T7）: 索引は捨ててよいが **history/ は
// 作り直せない**。`.OboeGaki` ごと消すと履歴も失う。
//
// このアプリのノートは front matter の id を持たないので、鍵は常に
// `path:<vault からの相対パス>`。改名・移動では rekey で置き場を付け替える。
//
// 版の名前は `<日時>@<書き手>.md`（ADR-0052 決定 2 / 11-2）。書き手は残した Mac の
// コンピュータ名。保管フォルダを共有すると、2 人が同じ瞬間に版を残しても名前が
// 衝突せず、履歴の窓で「誰がいつ変えたか」が見える。`@` の無い古い版は書き手不明。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::{Duration, NaiveDateTime};

pub const DEFAULT_INTERVAL_MINUTES: i64 = 60;
const MAX_VERSIONS: usize = 50;
const MAX_DAYS: i64 = 30;
const STAMP_FORMAT: &str = "%Y-%m-%dT%H-%M-%S";
/// 日時と書き手の区切り。日時の書式に `@` は出ないので、最初の `@` で分ければよい
const AUTHOR_MARK: char = '@';
/// 書き手の名前の上限（字）。長いコンピュータ名でファイル名の上限を超えないように
const MAX_AUTHOR_CHARS: usize = 40;

/// 書き手の名前をファイル名に使える形にする。`/` `:` と制御文字は `-` に、前後の
/// 空白は落とし、NFC に揃える（ADR-0050。同期ソフトが NFD で運び直しても同じ名前）。
/// 空なら空（書き手を混ぜない = 古い形の名前）
pub fn author_label(raw: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    raw.trim()
        .nfc()
        .map(|c| match c {
            '/' | ':' | '\\' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .take(MAX_AUTHOR_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// この Mac の書き手名（コンピュータ名。「システム設定 → 一般 → 情報」の名前）。
/// 読めなければ空 — 版は書き手なしの古い形で残る（残せないよりよい）。
/// 1 回だけ問い合わせて覚える（保存のたびにプロセスを起こさない）
pub fn this_mac() -> String {
    static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        std::process::Command::new("/usr/sbin/scutil")
            .args(["--get", "ComputerName"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| author_label(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default()
    })
    .clone()
}

/// 版のファイル名
fn version_file(stamp: NaiveDateTime, author: Option<&str>) -> String {
    let stamp = stamp.format(STAMP_FORMAT);
    match author {
        Some(author) => format!("{stamp}{AUTHOR_MARK}{author}.md"),
        None => format!("{stamp}.md"),
    }
}

/// 版のファイル名の幹から日時と書き手を読む。時刻でなければ None
fn parse_stem(stem: &str) -> Option<(NaiveDateTime, Option<String>)> {
    let (stamp, author) = match stem.split_once(AUTHOR_MARK) {
        Some((stamp, author)) if !author.is_empty() => (stamp, Some(author.to_string())),
        Some(_) => return None,
        None => (stem, None),
    };
    let saved_at = NaiveDateTime::parse_from_str(stamp, STAMP_FORMAT).ok()?;
    Some((saved_at, author))
}

/// 版の置き場（`.OboeGaki/history`）。名前はここが唯一の出所。
pub fn store_root(managed_dir: &Path) -> PathBuf {
    managed_dir.join("history")
}

/// 鍵をフォルダ名にする。`path:` の鍵は `/` を含むので短く畳む
/// （中身は読まないので、一意でありさえすればよい）。
pub fn folder_name(key: &str) -> String {
    use sha1::{Digest, Sha1};
    if !key.starts_with("path:") {
        return key.to_string();
    }
    let digest = Sha1::digest(key.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("path-{}", &hex[..16])
}

#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub path: PathBuf,
    pub saved_at: NaiveDateTime,
    /// 残した Mac の名前。古い版（書き手を混ぜる前）は None = 不明
    pub author: Option<String>,
}

impl Version {
    /// 一覧に出す時刻の字面。**一覧と引き当てで同じ形を使う**（食い違うと
    /// 「一覧に出た版が引けない」。GUI と MCP が別々に決めていたのを 1 つに。19-3）
    pub fn stamp(&self) -> String {
        self.saved_at.format("%Y-%m-%d %H:%M:%S").to_string()
    }
}

/// 今の全文を 1 版として残す。残したら場所を、残さなければ None。
///
/// 残さない場合（force は間引きだけ飛ばす）: 本文が空 / interval が 0 /
/// **同じ書き手の**直前の版から interval 分経っていない / 直前の版（誰のでも）と
/// 中身が同じ。author は `author_label` で整えた名前（空なら書き手を混ぜない）。
pub fn keep(
    root: &Path,
    key: &str,
    text: &str,
    now: NaiveDateTime,
    force: bool,
    interval_minutes: i64,
    author: &str,
) -> io::Result<Option<PathBuf>> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    if !force && interval_minutes <= 0 {
        return Ok(None);
    }
    let folder = folder_name(key);
    let author = Some(author).filter(|author| !author.is_empty());
    let found = versions_in(root, &folder);
    // 間引きと刻印の逃がしは**同じ書き手の版**を相手にする。他の人の直しで自分の版が
    // 間引かれず、他の Mac の時計の進みに自分の版の時刻が引きずられない
    let latest = found
        .iter()
        .find(|version| version.author.as_deref() == author);
    if let Some(latest) = latest {
        // 時刻の判定が先。ファイル名だけで済み、中身を読まずに大半を弾ける
        if !force && now - latest.saved_at < Duration::minutes(interval_minutes) {
            return Ok(None);
        }
    }
    // 中身の重複は誰の版とでも見る（同期で届いた同じ本文を二重に残さない）
    if let Some(newest) = found.first() {
        if let Ok(previous) = fs::read_to_string(&newest.path) {
            if previous == text {
                return Ok(None);
            }
        }
    }
    // 起点は最新の版より後ろに置く。秒を進めた版は「未来」の刻印になるので、
    // 同じ秒に古い版と同じ中身が来たとき、`now` から探すと古いファイルで
    // 止まって上書きしていた（レビュー 2026-09-25 / 21-5）。
    // 注意: 時計が戻ったとき（時差移動など）は、追いつくまで刻印が実時刻より
    // 先になり、一覧の時刻が実際とずれる。並びと T7（潰さない）を優先した
    let mut stamp = match latest {
        Some(latest) if latest.saved_at >= now => latest.saved_at + Duration::seconds(1),
        _ => now,
    };
    let mut target = root.join(&folder).join(version_file(stamp, author));
    // 同じ秒に中身の違う版が来たら、前の版を潰さず**秒を進める**（rekey と
    // 同じ逃げ方。枝番は STAMP_FORMAT で読めず一覧から消える）。以前は「同じ秒
    // なら上書きでよい」としていたが、MCP の差し替えを 1 秒以内に 2 回呼ぶと
    // 開いていないノートの唯一の旧本文が消えた（レビュー 2026-09-24。T7）
    while target.exists()
        && fs::read_to_string(&target)
            .map(|kept| kept != text)
            .unwrap_or(true)
    {
        stamp += Duration::seconds(1);
        target = root.join(&folder).join(version_file(stamp, author));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    // 履歴は唯一「作り直せない」資産（T7）なので、本文と同じく
    // アトミックに書く — 途中で落ちて切り詰められた版が正常な顔で
    // 並ぶと、それを選んだときノートまで壊れる（レビュー 2026-09-04）
    crate::autosave::save_atomic(&target, text)?;
    Ok(Some(target))
}

/// 履歴フォルダ全体が使っているバイト数（設定画面の「履歴の使用量」）。
/// 読めないものは 0 と数える — 表示のための概算で、正確さより落ちないこと。
pub fn usage(root: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(meta) = fs::metadata(&path) {
                total += meta.len();
            }
        }
    }
    total
}

/// 残っている版を新しい順に返す。読めないもの・変な名前は飛ばす。
pub fn versions(root: &Path, key: &str) -> Vec<Version> {
    versions_in(root, &folder_name(key))
}

/// 畳んだフォルダ名で引く内側（prune はフォルダを列挙するのでここへ来る）。
fn versions_in(root: &Path, folder: &str) -> Vec<Version> {
    let place = root.join(folder);
    let Ok(entries) = fs::read_dir(&place) else {
        return Vec::new();
    };
    let mut found: Vec<Version> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter_map(|path| {
            let stem = path.file_stem()?.to_str()?;
            if !crate::vault::is_markdown(&path) {
                return None;
            }
            let (saved_at, author) = parse_stem(stem)?;
            Some(Version {
                path,
                saved_at,
                author,
            })
        })
        .collect();
    // 同じ秒に別の書き手の版があっても並びが毎回同じになるよう、名前でも並べる
    found.sort_by(|a, b| {
        b.saved_at
            .cmp(&a.saved_at)
            .then_with(|| b.path.cmp(&a.path))
    });
    found
}

/// 版の置き場を別の鍵へ移す。移したら場所を、動かすものが無ければ None。
/// 行き先にも版があるときはどちらも捨てずにマージする（同時刻は上書き）。
pub fn rekey(root: &Path, before: &str, after: &str) -> io::Result<Option<PathBuf>> {
    if before == after {
        return Ok(None);
    }
    let source = root.join(folder_name(before));
    if !source.is_dir() {
        return Ok(None);
    }
    let target = root.join(folder_name(after));
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&source, &target)?;
        return Ok(Some(target));
    }
    // 行き先にも版がある（同じ名前のノートを消して作り直した等）。
    // どちらも捨てない。マージが要るのは**別のノートの版**と混ざるとき
    // なので、同じ時刻でも中身が同じとは限らない — fs::rename は行き先を
    // 黙って上書きするため、同名があれば枝番で逃がす（レビュー 2026-09-04）
    for entry in fs::read_dir(&source)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !crate::vault::is_markdown(&path) {
            continue;
        }
        let mut destination = target.join(entry.file_name());
        if destination.exists() {
            // 枝番を付けると STAMP_FORMAT で読めず一覧から消える。
            // 名前は時刻なので、**秒を進めて**空きを探す（並び順も自然）
            let stem = destination
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if let Some((mut stamp, author)) = parse_stem(&stem) {
                while destination.exists() {
                    stamp += Duration::seconds(1);
                    destination = target.join(version_file(stamp, author.as_deref()));
                }
            } else {
                // 時刻でない名前（想定外）は枝番で退避 — 消すよりまし
                let mut counter = 2;
                while destination.exists() {
                    destination = target.join(format!("{stem}-{counter}.md"));
                    counter += 1;
                }
            }
        }
        fs::rename(&path, &destination)?;
    }
    if fs::read_dir(&source)?.next().is_none() {
        fs::remove_dir(&source)?;
    }
    Ok(Some(target))
}

/// 多すぎる版（50 超）と古すぎる版（30 日超）を捨てる。古いほうから捨てる。
/// 掃除は片付けであって、失敗しても起動を止めない（エラーは飲む）。
pub fn prune(root: &Path, now: NaiveDateTime) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let deadline = now - Duration::days(MAX_DAYS);
    let mut removed = Vec::new();
    for folder in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        if !folder.is_dir() {
            continue;
        }
        let name = folder.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let found = versions_in(root, name);
        for (index, version) in found.iter().enumerate() {
            if (index >= MAX_VERSIONS || version.saved_at < deadline)
                && fs::remove_file(&version.path).is_ok()
            {
                removed.push(version.path.clone());
            }
        }
        if fs::read_dir(&folder)
            .map(|mut e| e.next().is_none())
            .unwrap_or(false)
        {
            let _ = fs::remove_dir(&folder);
        }
    }
    removed
}

#[cfg(test)]
// テスト名は日本語で書く。固有名（Finder / URL / Shift_JIS など）を小文字に
// 崩さないため、snake_case の警告はこの mod だけ黙らせる（15-3）
#[allow(non_snake_case)]
mod tests {
    #[test]
    fn test_rekey_時刻でない名前が両側にあれば枝番で退避する() {
        // 版の名前は時刻のはずだが、想定外の名前が来ても消さない（枝番で逃がす）
        let root = tempfile::TempDir::new().unwrap();
        let source = root.path().join(folder_name("path:a.md"));
        let target = root.path().join(folder_name("path:b.md"));
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("ゴミ.md"), "a 側").unwrap();
        std::fs::write(target.join("ゴミ.md"), "b 側").unwrap();
        rekey(root.path(), "path:a.md", "path:b.md").unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("ゴミ.md")).unwrap(),
            "b 側"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("ゴミ-2.md")).unwrap(),
            "a 側"
        );
        assert!(!source.exists(), "空になった元は消す");
    }

    use super::*;
    use chrono::NaiveDate;
    use tempfile::TempDir;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    #[test]
    fn test_usage_履歴フォルダの合計バイト数を返す() {
        let root = TempDir::new().unwrap();
        let folder = root.path().join(folder_name("path:a.md"));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("2026-09-04T10-00-00.md"), "12345").unwrap();
        fs::write(folder.join("2026-09-04T11-00-00.md"), "abc").unwrap();
        assert_eq!(usage(root.path()), 8);
        assert_eq!(usage(&root.path().join("無い")), 0);
    }

    #[test]
    fn test_rekey_マージで行き先の同名の版を潰さない() {
        // レビュー 2026-09-04: fs::rename は行き先を黙って上書きする。
        // マージが要るのは「別のノートの版と混ざるとき」なので、同じ
        // 時刻でも中身が同じとは限らない。どちらも残す
        let root = TempDir::new().unwrap();
        let source = root.path().join(folder_name("path:a.md"));
        let target = root.path().join(folder_name("path:b.md"));
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("2026-09-04T10-00-00.md"), "aの版").unwrap();
        fs::write(target.join("2026-09-04T10-00-00.md"), "bの版").unwrap();

        rekey(root.path(), "path:a.md", "path:b.md").unwrap();

        let mut contents: Vec<String> = fs::read_dir(&target)
            .unwrap()
            .filter_map(|e| fs::read_to_string(e.unwrap().path()).ok())
            .collect();
        contents.sort();
        assert_eq!(contents, vec!["aの版".to_string(), "bの版".to_string()]);
        // 逃がした版も一覧（STAMP_FORMAT）から見えること
        assert_eq!(versions(root.path(), "path:b.md").len(), 2);
    }

    #[test]
    fn test_keep_は一時ファイル経由で書く() {
        // 履歴は唯一「作り直せない」資産（T7）。書き込み中に落ちて
        // 切り詰められた版が正常な顔で並んではいけない
        let root = TempDir::new().unwrap();
        let now = NaiveDate::from_ymd_opt(2026, 9, 4)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap();
        let kept = keep(root.path(), "path:a.md", "本文", now, true, 60, "")
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(&kept).unwrap(), "本文");
        // 一時ファイルの残骸が無い
        let extras: Vec<_> = fs::read_dir(kept.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path() != kept)
            .collect();
        assert!(extras.is_empty(), "{extras:?}");
    }

    #[test]
    fn test_folder_name_パス鍵は短く畳み_それ以外は素通し() {
        let folded = folder_name("path:サブ/会議.md");
        assert!(folded.starts_with("path-"));
        assert_eq!(folded.len(), "path-".len() + 16);
        assert_eq!(folded, folder_name("path:サブ/会議.md")); // 安定
        assert_eq!(folder_name("01ABCULID"), "01ABCULID");
    }

    #[test]
    fn test_keep_空文とinterval0は残さない() {
        let dir = TempDir::new().unwrap();
        let now = at(2026, 9, 4, 10, 0);
        assert!(keep(dir.path(), "k", "  \n", now, false, 60, "")
            .unwrap()
            .is_none());
        assert!(keep(dir.path(), "k", "本文", now, false, 0, "")
            .unwrap()
            .is_none());
        // force なら interval 0 でも残す（明示保存の道）
        assert!(keep(dir.path(), "k", "本文", now, true, 0, "")
            .unwrap()
            .is_some());
    }

    #[test]
    fn test_keep_間引きと同内容の判定() {
        let dir = TempDir::new().unwrap();
        let first = keep(
            dir.path(),
            "k",
            "初版",
            at(2026, 9, 4, 10, 0),
            false,
            60,
            "",
        )
        .unwrap()
        .unwrap();
        assert!(first.ends_with("2026-09-04T10-00-00.md"));
        // 60 分経っていない → 残さない
        assert!(keep(
            dir.path(),
            "k",
            "改訂",
            at(2026, 9, 4, 10, 30),
            false,
            60,
            ""
        )
        .unwrap()
        .is_none());
        // force は間引きを飛ばす
        assert!(keep(
            dir.path(),
            "k",
            "改訂",
            at(2026, 9, 4, 10, 30),
            true,
            60,
            ""
        )
        .unwrap()
        .is_some());
        // 間隔が空いても中身が同じなら残さない
        assert!(keep(
            dir.path(),
            "k",
            "改訂",
            at(2026, 9, 4, 12, 0),
            false,
            60,
            ""
        )
        .unwrap()
        .is_none());
        // 間隔が空いて中身も違う → 残す
        assert!(keep(
            dir.path(),
            "k",
            "三版",
            at(2026, 9, 4, 12, 0),
            false,
            60,
            ""
        )
        .unwrap()
        .is_some());
    }

    // ------------------------------------------------ 書き手（ADR-0052 決定 2 / 11-2）

    #[test]
    fn test_keep_書き手を版の名前に混ぜる() {
        let dir = TempDir::new().unwrap();
        let kept = keep(
            dir.path(),
            "k",
            "本文",
            at(2026, 9, 4, 10, 0),
            true,
            0,
            "MacBook",
        )
        .unwrap()
        .unwrap();
        assert!(kept.ends_with("2026-09-04T10-00-00@MacBook.md"), "{kept:?}");
        let found = versions(dir.path(), "k");
        assert_eq!(found[0].author.as_deref(), Some("MacBook"));
        assert_eq!(found[0].saved_at, at(2026, 9, 4, 10, 0));
    }

    #[test]
    fn test_versions_書き手の無い古い版は不明として読む() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join(folder_name("k"));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("2026-09-04T10-00-00.md"), "古い版").unwrap();

        let found = versions(dir.path(), "k");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].author, None);
    }

    #[test]
    fn test_keep_同じ秒に別の書き手が残しても衝突しない() {
        // 共有フォルダで 2 人が同じ瞬間に版を残す。名前が違うので秒を進めなくてよい
        let dir = TempDir::new().unwrap();
        let now = at(2026, 9, 4, 10, 0);
        keep(dir.path(), "k", "A の本文", now, true, 0, "A").unwrap();
        keep(dir.path(), "k", "B の本文", now, true, 0, "B").unwrap();

        let found = versions(dir.path(), "k");
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|version| version.saved_at == now));
        let mut authors: Vec<_> = found.iter().filter_map(|v| v.author.clone()).collect();
        authors.sort();
        assert_eq!(authors, ["A", "B"]);
    }

    #[test]
    fn test_keep_間引きは書き手ごと() {
        // B が直したことは、A が 10 分前に残していても版に残す（誰が変えたかを見せる）
        let dir = TempDir::new().unwrap();
        let first = |minute, text, author| {
            keep(
                dir.path(),
                "k",
                text,
                at(2026, 9, 4, 10, minute),
                false,
                60,
                author,
            )
            .unwrap()
        };
        assert!(first(0, "A 一", "A").is_some());
        assert!(first(10, "B 一", "B").is_some());
        assert!(first(20, "A 二", "A").is_none(), "A の 60 分の間引きは効く");
    }

    #[test]
    fn test_keep_同じ中身なら別の書き手でも残さない() {
        let dir = TempDir::new().unwrap();
        keep(dir.path(), "k", "同じ", at(2026, 9, 4, 10, 0), true, 0, "A").unwrap();
        let again = keep(dir.path(), "k", "同じ", at(2026, 9, 4, 12, 0), true, 0, "B").unwrap();
        assert!(again.is_none());
    }

    #[test]
    fn test_keep_未来の刻印を避けるのは同じ書き手の版だけ() {
        // 他の Mac の時計が進んでいても、こちらの版の時刻を引きずられない
        let dir = TempDir::new().unwrap();
        keep(dir.path(), "k", "B", at(2026, 9, 4, 11, 0), true, 0, "B").unwrap();
        let kept = keep(dir.path(), "k", "A", at(2026, 9, 4, 10, 0), true, 0, "A")
            .unwrap()
            .unwrap();
        assert!(kept.ends_with("2026-09-04T10-00-00@A.md"), "{kept:?}");
    }

    #[test]
    fn test_書き手の名前はファイル名に使える形に整える() {
        assert_eq!(author_label("野村の/Mac:Pro"), "野村の-Mac-Pro");
        assert_eq!(author_label("  MacBook\n "), "MacBook");
        assert_eq!(author_label("改行\nあり"), "改行-あり");
        assert_eq!(author_label(""), "");
        assert_eq!(author_label("あ".repeat(100).as_str()).chars().count(), 40);
        // 濁点を分けた形（NFD）で来ても NFC に揃える（ADR-0050）
        assert_eq!(author_label("\u{30d8}\u{309a}"), "\u{30da}");
    }

    #[test]
    fn test_rekey_書き手付きの版も衝突したら秒を進める() {
        let root = TempDir::new().unwrap();
        keep(
            root.path(),
            "path:a.md",
            "a 側",
            at(2026, 9, 4, 10, 0),
            true,
            0,
            "A",
        )
        .unwrap();
        keep(
            root.path(),
            "path:b.md",
            "b 側",
            at(2026, 9, 4, 10, 0),
            true,
            0,
            "A",
        )
        .unwrap();

        rekey(root.path(), "path:a.md", "path:b.md").unwrap();

        let found = versions(root.path(), "path:b.md");
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|v| v.author.as_deref() == Some("A")));
        assert_eq!(
            found[0].saved_at,
            at(2026, 9, 4, 10, 0) + Duration::seconds(1)
        );
    }

    #[test]
    fn test_versions_新しい順で変な名前は飛ばす() {
        let dir = TempDir::new().unwrap();
        keep(dir.path(), "k", "一", at(2026, 9, 1, 9, 0), true, 60, "").unwrap();
        keep(dir.path(), "k", "二", at(2026, 9, 2, 9, 0), true, 60, "").unwrap();
        fs::write(dir.path().join(folder_name("k")).join("ゴミ.md"), "x").unwrap();

        let found = versions(dir.path(), "k");
        assert_eq!(found.len(), 2);
        assert!(found[0].saved_at > found[1].saved_at);
        assert_eq!(fs::read_to_string(&found[0].path).unwrap(), "二");
    }

    #[test]
    fn test_rekey_置き場を付け替え_行き先があればマージ() {
        let dir = TempDir::new().unwrap();
        assert!(rekey(dir.path(), "path:a.md", "path:b.md")
            .unwrap()
            .is_none());

        keep(
            dir.path(),
            "path:a.md",
            "一",
            at(2026, 9, 1, 9, 0),
            true,
            60,
            "",
        )
        .unwrap();
        let moved = rekey(dir.path(), "path:a.md", "path:b.md")
            .unwrap()
            .unwrap();
        assert_eq!(versions(dir.path(), "path:b.md").len(), 1);
        assert!(!dir.path().join(folder_name("path:a.md")).exists());
        assert_eq!(moved, dir.path().join(folder_name("path:b.md")));

        // 行き先にも版がある → どちらも捨てない
        keep(
            dir.path(),
            "path:c.md",
            "丙",
            at(2026, 9, 2, 9, 0),
            true,
            60,
            "",
        )
        .unwrap();
        rekey(dir.path(), "path:c.md", "path:b.md").unwrap();
        assert_eq!(versions(dir.path(), "path:b.md").len(), 2);
    }

    #[test]
    fn test_prune_多すぎる版と古すぎる版を古いほうから捨てる() {
        let dir = TempDir::new().unwrap();
        // 55 版（1 時間おき）。50 版を超えたぶんの古いほうが消える
        for index in 0..55u32 {
            keep(
                dir.path(),
                "k",
                &format!("版{index}"),
                at(2026, 9, 1, 0, 0) + Duration::hours(index as i64),
                true,
                60,
                "",
            )
            .unwrap();
        }
        let removed = prune(dir.path(), at(2026, 9, 10, 0, 0));
        assert_eq!(removed.len(), 5);
        assert_eq!(versions(dir.path(), "k").len(), 50);

        // 30 日を超えた版は数が少なくても消える
        let dir2 = TempDir::new().unwrap();
        keep(dir2.path(), "k", "古い", at(2026, 7, 1, 0, 0), true, 60, "").unwrap();
        keep(
            dir2.path(),
            "k",
            "新しい",
            at(2026, 9, 1, 0, 0),
            true,
            60,
            "",
        )
        .unwrap();
        let removed = prune(dir2.path(), at(2026, 9, 4, 0, 0));
        assert_eq!(removed.len(), 1);
        let left = versions(dir2.path(), "k");
        assert_eq!(left.len(), 1);
        assert_eq!(fs::read_to_string(&left[0].path).unwrap(), "新しい");
    }

    #[test]
    fn test_prune_置き場が無ければ何もしない() {
        let dir = TempDir::new().unwrap();
        assert!(prune(&dir.path().join("無い"), at(2026, 9, 4, 0, 0)).is_empty());
    }

    /// 同じ秒に中身の違う版が 2 回来ても、前の版を潰さない（レビュー 2026-09-24。
    /// MCP の replace_note を 1 秒以内に 2 回呼ぶと、開いていないノートの唯一の
    /// 旧本文が消えていた = T7）
    #[test]
    fn test_keep_同じ秒に中身の違う版が来ても前の版を潰さない() {
        let dir = tempfile::TempDir::new().unwrap();
        let now = at(2026, 9, 24, 10, 0);
        let first = keep(dir.path(), "path:a.md", "A\n", now, true, 0, "")
            .unwrap()
            .unwrap();
        let second = keep(dir.path(), "path:a.md", "B\n", now, true, 0, "")
            .unwrap()
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), "A\n");
        assert_eq!(fs::read_to_string(&second).unwrap(), "B\n");
        // 一覧にも両方出る（秒を進めた名前は STAMP_FORMAT で読める）
        assert_eq!(versions(dir.path(), "path:a.md").len(), 2);
        // 同じ中身が同じ秒に来たときは 1 つのまま
        let again = keep(dir.path(), "path:a.md", "B\n", now, true, 0, "").unwrap();
        assert!(again.is_none());
    }

    /// 秒を進めた版のあとに、古い版と同じ中身が同じ秒に来ても古い版を潰さない
    #[test]
    fn test_keep_未来の刻印がある間も古い版を上書きしない() {
        let dir = tempfile::TempDir::new().unwrap();
        let now = at(2026, 9, 25, 10, 0);
        let first = keep(dir.path(), "path:a.md", "A\n", now, true, 0, "")
            .unwrap()
            .unwrap();
        keep(dir.path(), "path:a.md", "B\n", now, true, 0, "")
            .unwrap()
            .unwrap();
        // A に戻す（同じ秒）。最新は B なので中身は違う → 3 つ目として残る
        let third = keep(dir.path(), "path:a.md", "A\n", now, true, 0, "")
            .unwrap()
            .unwrap();
        assert_ne!(third, first);
        assert_eq!(fs::read_to_string(&first).unwrap(), "A\n");
        assert_eq!(versions(dir.path(), "path:a.md").len(), 3);
    }
}
