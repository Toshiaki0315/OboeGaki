// 未保存の退避と復元（H-1。終了時に書けなかったぶんを次の起動で拾う）。
// Tauri commands の薄い層（T3）。分け方は commands/mod.rs を見る

use super::{guarded, index_one, CmdError, CmdResult, WatchState};
use crate::vault::Vault;
use std::path::{Path, PathBuf};

/// 退避の置き場（vault ごと）。アプリのデータフォルダの下に作る。
///
/// vault の中に置かないのは、**保存できない理由が vault 側にあることが多い**
/// ため（権限・容量・同期の衝突）。書けない場所へ保険を置いても保険にならない。
fn recovery_dir(app: &tauri::AppHandle, root: &str) -> CmdResult<std::path::PathBuf> {
    use tauri::Manager;
    let base = app.path().app_data_dir()?;
    Ok(crate::recovery::vault_dir(&base, Path::new(root)))
}

/// 未保存の内容を退避する（保存できないまま落ちたときの保険）。
#[tauri::command]
pub fn recovery_stash(
    app: tauri::AppHandle,
    root: String,
    path: String,
    text: String,
) -> CmdResult<()> {
    let path = guarded(&root, &path)?;
    let dir = recovery_dir(&app, &root)?;
    crate::recovery::stash(&dir, &path, &text)
        .map(|_| ())
        .map_err(CmdError::from)
}

/// 保存できたので退避を捨てる。
#[tauri::command]
pub fn recovery_discard(app: tauri::AppHandle, root: String, path: String) -> CmdResult<()> {
    let path = guarded(&root, &path)?;
    crate::recovery::discard(&recovery_dir(&app, &root)?, &path);
    Ok(())
}

/// 前回の未保存内容（起動時に拾う）。
#[tauri::command]
pub fn recovery_pending(
    app: tauri::AppHandle,
    root: String,
) -> CmdResult<Vec<crate::recovery::Stashed>> {
    Ok(crate::recovery::pending(&recovery_dir(&app, &root)?))
}

/// 退避を**別ファイルとして**書き出す。書いた場所を返す。
///
/// 元のファイルは上書きしない。書き出したら退避は捨てる（同じものを
/// 次の起動でもう一度勧めない）。
#[tauri::command]
pub fn recovery_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    root: String,
) -> CmdResult<Vec<String>> {
    let vault = Vault::new(&root);
    let dir = recovery_dir(&app, &root)?;
    let restored = restore_pending(&vault, &dir);
    for path in &restored {
        state.suppressor.mark(path);
        index_one(&vault, path);
    }
    Ok(restored
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// 退避を 1 つずつ復元し、**復元できたものだけ**捨てる。
///
/// 失敗した退避は残す — 退避は未保存本文の唯一の写しで、権限や容量の不調で
/// 復元が失敗するのはまさに退避が要る場面。以前は最後に全部捨てていた
/// （監査 2026-09-17）。1 つ書けなくても残りは救う。Tauri を知らないので
/// ヘッドレスで試せる（T3）
pub fn restore_pending(vault: &Vault, dir: &Path) -> Vec<PathBuf> {
    let mut restored = Vec::new();
    for stashed in crate::recovery::pending(dir) {
        let source = Path::new(&stashed.source);
        let stamp = chrono::DateTime::from_timestamp_millis(stashed.stashed_at_ms)
            .map(|at| {
                at.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d")
                    .to_string()
            })
            .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        match vault.restore_stash(source, &stashed.text, &stamp) {
            Ok(path) => {
                crate::recovery::discard(dir, source);
                restored.push(path);
            }
            Err(error) => eprintln!("退避を復元できなかった（{}）: {error}", stashed.source),
        }
    }
    restored
}

/// 退避を全部捨てる（「復元しない」を選んだとき）。
#[tauri::command]
pub fn recovery_clear(app: tauri::AppHandle, root: String) -> CmdResult<()> {
    crate::recovery::clear_all(&recovery_dir(&app, &root)?);
    Ok(())
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::temp_vault;

    /// 復元に失敗した退避は**捨てない**。退避は未保存本文の唯一の写しで、権限や
    /// 容量の不調で復元が失敗するのはまさに退避が要る場面（監査 2026-09-17）
    #[test]
    fn test_restore_pending_復元できたものだけ捨て_失敗した退避は残す() {
        let (root, vault) = temp_vault();
        let dir = tempfile::TempDir::new().unwrap();
        let inside = root.path().join("a.md");
        let outside = std::path::Path::new("/etc/よそ.md"); // 保管フォルダの外 → 復元は断られる
        crate::recovery::stash(dir.path(), &inside, "# a\n\n未保存\n").unwrap();
        crate::recovery::stash(dir.path(), outside, "外の本文\n").unwrap();

        let restored = restore_pending(&vault, dir.path());
        assert_eq!(restored.len(), 1);
        assert!(std::fs::read_to_string(&restored[0])
            .unwrap()
            .contains("未保存"));
        let left = crate::recovery::pending(dir.path());
        assert_eq!(left.len(), 1, "失敗した退避が消えている");
        assert_eq!(left[0].source, outside.to_string_lossy());
    }
}
