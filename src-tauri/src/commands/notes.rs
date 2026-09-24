// ノートの読み書き・作成（無題・雛形・日次）・一覧と検索・改名と移動・ピン・リンク。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::history::{history_key, history_root};
use super::text::RenameOutcome;
use super::{guarded, index_one, CmdError, CmdResult, WatchState};
use crate::autosave;
use crate::history;
use crate::index_db::{IndexDb, SearchHit};
use crate::vault::{NewNote, Vault};
use std::path::Path;

/// そのノートが今もあるか（spec §7.5）。
///
/// 改名やゴミ箱移動の途中でも「消えた」イベントは届くので、
/// **本当に無いときだけ聞く**ために使う。
#[tauri::command]
pub fn note_exists(root: String, path: String) -> CmdResult<bool> {
    // guarded はフォルダごと外部削除されると canonicalize に失敗して
    // 「vault の外」というエラーに化け、フロントの void 経路が全部飛ぶ
    //（削除ダイアログも退避も出ず、自動保存が消したフォルダを復活させる —
    // レビュー 2026-09-04）。ここの問いは「在るか」なので、判定できない
    // ものは「無い」と答える
    Ok(guarded(&root, &path).map(|p| p.is_file()).unwrap_or(false))
}

#[tauri::command]
pub async fn note_read(root: String, path: String) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    crate::vault::read_note(&path).map_err(CmdError::from)
}

#[tauri::command]
pub async fn note_write(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    text: String,
    // 版を残す間隔（分。環境設定）。0 は「なし」= 自分で保存したときだけ
    history_minutes: Option<i64>,
) -> CmdResult<()> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    autosave::save_atomic(&path, &text)?;
    // 索引の後追い。失敗しても保存は成立している（次の sync が取り直す）
    let vault = Vault::new(&root);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    // 版の履歴（ADR-0023）。60 分間引き。失敗しても保存は成立している
    if let Err(error) = history::keep(
        &history_root(&root),
        &history_key(&root, &path),
        &text,
        chrono::Local::now().naive_local(),
        false,
        history_minutes.unwrap_or(history::DEFAULT_INTERVAL_MINUTES),
    ) {
        eprintln!("版を残せなかった: {error}");
    }
    Ok(())
}

/// 一覧の素材（題名・プレビュー・更新時刻）。並び順はフロント側の持ち物。
#[tauri::command]
pub async fn note_list(root: String) -> CmdResult<Vec<crate::index_db::NoteMeta>> {
    let vault = Vault::new(&root);
    let db = IndexDb::open(&vault.managed_dir())?;
    Ok(crate::note_service::list_notes(&db, None, None)?)
}

/// ノートを複製する（一覧の右クリック）。作った先を返す。
#[tauri::command]
pub fn note_duplicate(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    let copy = vault.duplicate(&path)?;
    state.suppressor.mark(&copy);
    index_one(&vault, &copy);
    Ok(copy.to_string_lossy().into_owned())
}

/// ノートを雛形として登録する（一覧の右クリック）。置いた場所を返す。
#[tauri::command]
pub fn template_register(root: String, path: String, name: String) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    Vault::new(&root)
        .register_template(&path, &name)
        .map(|placed| placed.to_string_lossy().into_owned())
        .map_err(CmdError::from)
}

/// そのタグ（と配下のタグ）が付いたノートだけの一覧（C-4）。
/// サイドバーのタグクリックはこれで絞る。
#[tauri::command]
pub fn notes_with_tag(root: String, tag: String) -> CmdResult<Vec<crate::index_db::NoteMeta>> {
    let vault = Vault::new(&root);
    let db = IndexDb::open(&vault.managed_dir())?;
    Ok(crate::note_service::list_notes(&db, None, Some(&tag))?)
}

/// 検索の結果。読めなかった `after:` / `before:` を一緒に返す。
///
/// **探すのはやめない**（言葉として扱う）が、書き方が違うことは画面から
/// 読めるようにする。0 件になった理由が分からないと打ち間違いに気づけない。
#[derive(serde::Serialize)]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub unreadable: Vec<String>,
}

#[tauri::command]
pub async fn note_search(root: String, query: String) -> CmdResult<SearchOutcome> {
    let vault = Vault::new(&root);
    let hits = IndexDb::open(&vault.managed_dir()).and_then(|db| db.search(&query))?;
    Ok(SearchOutcome {
        hits,
        unreadable: crate::search_query::parse(&query).unreadable_dates,
    })
}

/// 新しいノートを作る。`folder` を渡すとその中に作る（省略で直下）。
#[tauri::command]
pub fn note_create(
    state: tauri::State<'_, WatchState>,
    root: String,
    title: String,
    folder: Option<String>,
) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let path = vault.create_in(folder.as_deref().unwrap_or(""), &title)?;
    state.suppressor.mark(&path);
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(path.to_string_lossy().into_owned())
}

/// `templates/` にある雛形の一覧（絶対パス。名前順）。
#[tauri::command]
pub fn template_list(root: String) -> CmdResult<Vec<String>> {
    Ok(Vault::new(&root)
        .templates()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// 雛形から新しいノートを作る（E-4）。題名が空なら雛形の名前を使う。
#[tauri::command]
pub fn note_create_from_template(
    state: tauri::State<'_, WatchState>,
    root: String,
    template: String,
    title: String,
) -> CmdResult<NewNote> {
    let vault = Vault::new(&root);
    let made = vault.create_from_template(Path::new(&template), &title, &chrono::Local::now())?;
    state.suppressor.mark(&made.path);
    index_one(&vault, &made.path);
    Ok(made)
}

/// 今日のノート（E-4）。無ければ日次の雛形から作る。
#[tauri::command]
pub fn note_daily(
    state: tauri::State<'_, WatchState>,
    root: String,
    day: Option<String>,
) -> CmdResult<NewNote> {
    let vault = Vault::new(&root);
    // 日付を渡さなければ今日（`Cmd+T`）。渡すときは `YYYY-MM-DD`（7-5）
    let when = match day {
        Some(text) => parse_day(&text).ok_or("日付を読み取れません")?,
        None => chrono::Local::now(),
    };
    let made = vault.daily_note(&when)?;
    state.suppressor.mark(&made.path);
    index_one(&vault, &made.path);
    Ok(made)
}

/// `YYYY-MM-DD` をその日の 0 時（この機械の時間帯）にする。
///
/// **時刻は持たない。** 日付だけで決まるノートなので、時刻を混ぜると
/// 時間帯の境目で前の日のノートが開く。
pub fn parse_day(text: &str) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::TimeZone;
    let day = chrono::NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d").ok()?;
    chrono::Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0)?)
        .single()
}

/// このノートを `[[…]]` で指しているノート（E-6）。
#[tauri::command]
pub async fn note_backlinks(
    root: String,
    title: String,
) -> CmdResult<Vec<crate::index_db::Backlink>> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.backlinks(&title))
        .map_err(CmdError::from)
}

/// 関連するノート（L-3）。**モデルは通さない** — 根拠は索引の中にある
/// ので、Ollama を入れていなくても出る。
#[derive(serde::Serialize)]
pub struct RelatedNote {
    /// vault からの相対パス
    pub path: String,
    pub title: String,
    /// 出た理由（**そのまま画面に出す**。読めないと確かめようがない）
    pub reasons: Vec<String>,
}

#[tauri::command]
pub async fn note_related(
    root: String,
    path: String,
    title: String,
) -> CmdResult<Vec<RelatedNote>> {
    let vault = Vault::new(&root);
    let relative = Path::new(&path)
        .strip_prefix(&root)
        .map(|rest| rest.to_string_lossy().into_owned())
        .unwrap_or(path.clone());
    let db = IndexDb::open(&vault.managed_dir())?;
    let ranked = db.related_notes(&relative, &title, crate::related::DEFAULT_LIMIT, |_| true)?;
    Ok(ranked
        .into_iter()
        .map(|(item, found_title)| RelatedNote {
            title: found_title.unwrap_or_else(|| item.key.clone()),
            path: item.key,
            reasons: item.reasons,
        })
        .collect())
}

/// リンクの図の素材（M-2）。`(指すノートの題名, 指し先, 続柄)`。
///
/// **図は索引から作る。** 本文を全部読み直すと大きな vault で待たされる。
#[tauri::command]
pub fn link_map(root: String) -> CmdResult<Vec<(String, String, String)>> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.link_map())
        .map_err(CmdError::from)
}

/// ノートをフォルダへ移す（ADR-0024）。移した先の絶対パスを返す。
#[tauri::command]
pub fn note_move(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    folder: String,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    let vault = Vault::new(&root);
    state.suppressor.mark(&path);
    let moved = vault.move_note(&path, &folder)?;
    if moved == path {
        return Ok(moved.to_string_lossy().into_owned());
    }
    state.suppressor.mark(&moved);
    if let Err(error) = IndexDb::open(&vault.managed_dir()).and_then(|mut db| {
        db.remove(&vault, &path)?;
        db.upsert(&vault, &moved)
    }) {
        eprintln!("索引の更新に失敗した: {error}");
    }
    // 履歴の付け替えは move_note がやる（鍵はファイルに付いて回る = ADR-0042）
    Ok(moved.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn note_rename(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    title: String,
) -> CmdResult<RenameOutcome> {
    let path = guarded(&root, &path)?;
    state.suppressor.mark(&path);
    let renamed = Vault::new(&root).rename(&path, &title)?;
    state.suppressor.mark(&renamed);
    let stem = |p: &Path| {
        p.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let (old_title, new_title) = (stem(&path), stem(&renamed));
    // 索引: 旧パスを外し、新パスを載せ直す。続けて、旧題名を指している
    // ノートの `[[リンク]]` を新題名に書き換える（ADR-0053）
    let vault = Vault::new(&root);
    let mut rewritten = 0;
    let mut failed = Vec::new();
    match IndexDb::open(&vault.managed_dir()) {
        Ok(mut db) => {
            if let Err(error) = db
                .remove(&vault, &path)
                .and_then(|_| db.upsert(&vault, &renamed))
            {
                eprintln!("索引の更新に失敗した: {error}");
            }
            if old_title != new_title {
                let outcome =
                    crate::link_rewrite::rewrite_links_to(&vault, &mut db, &old_title, &new_title);
                for written in &outcome.paths {
                    state.suppressor.mark(written);
                }
                rewritten = outcome.rewritten;
                failed = outcome.failed;
            }
        }
        Err(error) => eprintln!("索引を開けなかった: {error}"),
    }
    // 版は vault.rename が連れて行く（鍵はファイルに付いて回る = ADR-0042）
    Ok(RenameOutcome {
        path: renamed.to_string_lossy().into_owned(),
        rewritten,
        failed,
    })
}

/// 今日のノートの末尾に追記（どこからでも書き取り = ADR-0057 / 12-6）。
/// 書き取りの窓から呼ぶ。監視の抑制はしない（主窓が読み直す）
#[tauri::command]
pub fn note_append_daily(root: String, text: String) -> CmdResult<String> {
    let vault = Vault::new(&root);
    let path = vault.append_to_daily(&chrono::Local::now(), &text)?;
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(path.to_string_lossy().into_owned())
}

/// ピン留めを付け外しする（spec §7.3）。front matter の `pinned: true` に
/// 永続化し、書き換え後の本文を返す（開いているエディタが差し替えるため）。
#[tauri::command]
pub fn note_pin(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    pinned: bool,
) -> CmdResult<String> {
    let path = guarded(&root, &path)?;
    let text = crate::vault::read_note(&path)?;
    let updated = crate::front_matter::with_pinned(&text, pinned);
    if updated != text {
        let vault = Vault::new(&root);
        state.suppressor.mark(&path);
        vault.write_with_version(&path, &text, &updated)?;
        if let Err(error) =
            IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &path))
        {
            eprintln!("索引の更新に失敗した: {error}");
        }
    }
    Ok(updated)
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_日付は年月日だけを読む() {
        use chrono::Datelike;
        let day = parse_day("2026-09-06").expect("読めるはず");
        assert_eq!((day.year(), day.month(), day.day()), (2026, 9, 6));
        // 時刻は 0 時（時間帯の境目で前の日のノートを開かない）
        assert_eq!(day.format("%H:%M").to_string(), "00:00");
    }

    #[test]
    fn test_読めない日付は断る() {
        assert!(parse_day("").is_none());
        assert!(parse_day("2026/09/06").is_none());
        assert!(parse_day("2026-13-40").is_none());
        assert!(parse_day("きのう").is_none());
    }
}
