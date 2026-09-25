// 本文をまたいで書き換えるもの: やること・置換・タグの改名・タグの一覧。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{guarded, CmdError, CmdResult, WatchState};
use crate::index_db::IndexDb;
use crate::vault::Vault;

/// タグと件数（サイドバーのタグ一覧）。
#[tauri::command]
pub fn tag_list(root: String) -> CmdResult<Vec<(String, i64)>> {
    let vault = Vault::new(&root);
    let db = IndexDb::open(&vault.managed_dir())?;
    Ok(crate::note_service::tags_with_counts(&db, |_| true)?)
}

/// 未完了のやること（ADR-0056 / 12-5）
#[tauri::command]
pub fn task_list(root: String) -> CmdResult<Vec<crate::index_db::TaskRow>> {
    let vault = Vault::new(&root);
    IndexDb::open(&vault.managed_dir())
        .and_then(|db| db.open_tasks())
        .map_err(CmdError::from)
}

/// やることを完了にする（開いていないノート用。開いているノートはエディタで
/// 書く）。本文の編集なので、書いたノートは監視から抑制して索引を更新する
#[tauri::command]
pub fn task_complete(
    state: tauri::State<'_, WatchState>,
    root: String,
    path: String,
    line: usize,
    text: String,
) -> CmdResult<()> {
    let note = guarded(&root, &path)?;
    let current = crate::vault::read_note(&note)?;
    // 一覧の行番号は索引の写し。文も突き合わせ、ずれていれば触らない。
    // 既に完了しているなら何も書かずに成功（別の窓や MCP で済んでいた）
    let rewritten = match crate::tasks::complete_matching(&current, line, &text) {
        crate::tasks::Completion::Rewritten(rewritten) => rewritten,
        crate::tasks::Completion::AlreadyDone => return Ok(()),
        crate::tasks::Completion::Mismatch => {
            return Err(
                "やることの行がずれています。一覧を更新してからもう一度お試しください".into(),
            )
        }
    };
    let vault = Vault::new(&root);
    state.suppressor.mark(&note);
    vault.write_with_version(&note, &current, &rewritten)?;
    if let Err(error) =
        IndexDb::open(&vault.managed_dir()).and_then(|mut db| db.upsert(&vault, &note))
    {
        eprintln!("索引の更新に失敗した: {error}");
    }
    Ok(())
}

/// 置換の下見（ADR-0055 / 12-3）。書かずに、何件のノートの何箇所が当たるかだけ
#[tauri::command]
pub fn replace_preview(
    root: String,
    from: String,
    case_sensitive: bool,
    include_code: bool,
) -> CmdResult<ReplaceCount> {
    let vault = Vault::new(&root);
    let outcome = crate::link_rewrite::rewrite_all(&vault, None, |text| {
        crate::text_rewrite::replace_outside_code(text, &from, "", case_sensitive, include_code)
    });
    Ok(ReplaceCount {
        notes: outcome.rewritten,
        occurrences: outcome.occurrences,
    })
}

/// 置換を実行する。書いたノートは監視から抑制し、フロントが開いている
/// ノートを読み直す（戻りの `paths`）
#[tauri::command]
pub fn replace_apply(
    state: tauri::State<'_, WatchState>,
    root: String,
    from: String,
    to: String,
    case_sensitive: bool,
    include_code: bool,
) -> CmdResult<ReplaceOutcome> {
    let vault = Vault::new(&root);
    let mut db = IndexDb::open(&vault.managed_dir())?;
    let outcome = crate::link_rewrite::rewrite_all(&vault, Some(&mut db), |text| {
        crate::text_rewrite::replace_outside_code(text, &from, &to, case_sensitive, include_code)
    });
    for written in &outcome.paths {
        state.suppressor.mark(written);
    }
    Ok(ReplaceOutcome {
        notes: outcome.rewritten,
        occurrences: outcome.occurrences,
        paths: outcome
            .paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        failed: outcome.failed,
    })
}

/// タグの改名・統合（ADR-0055 / 12-4）。`to` が既にあるタグなら統合になる
/// （判断と確認はフロント）。書いたノートは監視から抑制する
#[tauri::command]
pub fn tag_rename(
    state: tauri::State<'_, WatchState>,
    root: String,
    from: String,
    to: String,
) -> CmdResult<ReplaceOutcome> {
    let vault = Vault::new(&root);
    let mut db = IndexDb::open(&vault.managed_dir())?;
    let outcome = crate::link_rewrite::rewrite_all(&vault, Some(&mut db), |text| {
        crate::text_rewrite::rename_tag(text, &from, &to)
    });
    for written in &outcome.paths {
        state.suppressor.mark(written);
    }
    Ok(ReplaceOutcome {
        notes: outcome.rewritten,
        occurrences: outcome.occurrences,
        paths: outcome
            .paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        failed: outcome.failed,
    })
}

#[derive(serde::Serialize)]
pub struct ReplaceCount {
    pub notes: usize,
    pub occurrences: usize,
}

#[derive(serde::Serialize)]
pub struct ReplaceOutcome {
    pub notes: usize,
    pub occurrences: usize,
    pub paths: Vec<String>,
    pub failed: Vec<String>,
}

/// 改名の結果。`rewritten` は `[[リンク]]` を書き換えた他のノートの数
#[derive(serde::Serialize)]
pub struct RenameOutcome {
    pub path: String,
    pub rewritten: usize,
    pub failed: Vec<String>,
}
