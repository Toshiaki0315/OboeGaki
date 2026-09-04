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

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::{Duration, NaiveDateTime};

pub const DEFAULT_INTERVAL_MINUTES: i64 = 60;
const MAX_VERSIONS: usize = 50;
const MAX_DAYS: i64 = 30;
const STAMP_FORMAT: &str = "%Y-%m-%dT%H-%M-%S";

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
}

/// 今の全文を 1 版として残す。残したら場所を、残さなければ None。
///
/// 残さない場合（force は間引きだけ飛ばす）: 本文が空 / interval が 0 /
/// 直前の版から interval 分経っていない / 直前の版と中身が同じ。
pub fn keep(
    root: &Path,
    key: &str,
    text: &str,
    now: NaiveDateTime,
    force: bool,
    interval_minutes: i64,
) -> io::Result<Option<PathBuf>> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    if !force && interval_minutes <= 0 {
        return Ok(None);
    }
    let folder = folder_name(key);
    if let Some(latest) = versions_in(root, &folder).into_iter().next() {
        // 時刻の判定が先。ファイル名だけで済み、中身を読まずに大半を弾ける
        if !force && now - latest.saved_at < Duration::minutes(interval_minutes) {
            return Ok(None);
        }
        if let Ok(previous) = fs::read_to_string(&latest.path) {
            if previous == text {
                return Ok(None);
            }
        }
    }
    let target = root
        .join(&folder)
        .join(format!("{}.md", now.format(STAMP_FORMAT)));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    // 同じ秒に 2 回来たら上書きでよい（中身は同じか、直後の打ち直し）。
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
            if path.extension()?.to_str()? != "md" {
                return None;
            }
            let saved_at = NaiveDateTime::parse_from_str(stem, STAMP_FORMAT).ok()?;
            Some(Version { path, saved_at })
        })
        .collect();
    found.sort_by_key(|version| std::cmp::Reverse(version.saved_at));
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
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
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
            if let Ok(mut stamp) = NaiveDateTime::parse_from_str(&stem, STAMP_FORMAT) {
                while destination.exists() {
                    stamp += Duration::seconds(1);
                    destination = target.join(format!("{}.md", stamp.format(STAMP_FORMAT)));
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
mod tests {
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
        let kept = keep(root.path(), "path:a.md", "本文", now, true, 60)
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
        assert!(keep(dir.path(), "k", "  \n", now, false, 60)
            .unwrap()
            .is_none());
        assert!(keep(dir.path(), "k", "本文", now, false, 0)
            .unwrap()
            .is_none());
        // force なら interval 0 でも残す（明示保存の道）
        assert!(keep(dir.path(), "k", "本文", now, true, 0)
            .unwrap()
            .is_some());
    }

    #[test]
    fn test_keep_間引きと同内容の判定() {
        let dir = TempDir::new().unwrap();
        let first = keep(dir.path(), "k", "初版", at(2026, 9, 4, 10, 0), false, 60)
            .unwrap()
            .unwrap();
        assert!(first.ends_with("2026-09-04T10-00-00.md"));
        // 60 分経っていない → 残さない
        assert!(
            keep(dir.path(), "k", "改訂", at(2026, 9, 4, 10, 30), false, 60)
                .unwrap()
                .is_none()
        );
        // force は間引きを飛ばす
        assert!(
            keep(dir.path(), "k", "改訂", at(2026, 9, 4, 10, 30), true, 60)
                .unwrap()
                .is_some()
        );
        // 間隔が空いても中身が同じなら残さない
        assert!(
            keep(dir.path(), "k", "改訂", at(2026, 9, 4, 12, 0), false, 60)
                .unwrap()
                .is_none()
        );
        // 間隔が空いて中身も違う → 残す
        assert!(
            keep(dir.path(), "k", "三版", at(2026, 9, 4, 12, 0), false, 60)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn test_versions_新しい順で変な名前は飛ばす() {
        let dir = TempDir::new().unwrap();
        keep(dir.path(), "k", "一", at(2026, 9, 1, 9, 0), true, 60).unwrap();
        keep(dir.path(), "k", "二", at(2026, 9, 2, 9, 0), true, 60).unwrap();
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
            )
            .unwrap();
        }
        let removed = prune(dir.path(), at(2026, 9, 10, 0, 0));
        assert_eq!(removed.len(), 5);
        assert_eq!(versions(dir.path(), "k").len(), 50);

        // 30 日を超えた版は数が少なくても消える
        let dir2 = TempDir::new().unwrap();
        keep(dir2.path(), "k", "古い", at(2026, 7, 1, 0, 0), true, 60).unwrap();
        keep(dir2.path(), "k", "新しい", at(2026, 9, 1, 0, 0), true, 60).unwrap();
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
}
