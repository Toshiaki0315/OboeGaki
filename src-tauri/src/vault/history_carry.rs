// 履歴の鍵と引き継ぎ（17-2）。`history_key` が鍵の字面を決める唯一の場所で、
// `carry_history` が履歴を動かす唯一の道（trash / restore / rename / move が全部通る）

use super::*;

/// 貼り付け元から来た拡張子を、ファイル名に使える形へ直す。
///
/// クリップボードやドロップ元の文字列をそのまま繋ぐと、`../` や空白で
/// attachments の外へ書ける。英数字だけ残す（参照実装 attachment_suffix）。
/// root からの相対部分を Unicode NFC に揃えた絶対パス（root はそのまま）。
///
/// macOS のファイルシステム（APFS / HFS+）は正規化の違いを**同じ名前**として
/// 扱うが、パスの文字列としては別物になる。Cocoa のアプリ（テキストエディタ
/// など）は NFD のパスで書くので、FSEvents から届くパスも NFD になり、索引の
/// キー（文字列）が二重になった（実機 2026-09-09: 一覧に同じノートが 2 行）。
/// パスが文字列になる境目（走査・索引・監視イベント）で全部ここを通す。
/// root の外のパスは触らない（相対にできないものは判断しない）。
/// ノートの履歴の鍵（ADR-0023 / ADR-0042: id を持たないので vault からの相対パス）。
///
/// **経路によらず同じ字面にする**（監査 2026-09-17）。以前は `guarded` の実体
/// （canonicalize 済み: `/var` ↔ `/private/var`、シンボリックリンクの下、NFD の
/// まま）、`after_folder_moved` の NFC、`carry_history` の生 root の剥がし、と
/// 3 通りあり、同じノートの版が経路によって見つからなかった。ここでは root も
/// パスも実体に解決してから相対にし、NFC に寄せる。まだ無いファイル（これから
/// 書く・戻す先）は親で解決する
pub fn history_key(root: &Path, path: &Path) -> String {
    let real_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let real = resolve_existing(path);
    let relative = real
        .strip_prefix(&real_root)
        .or_else(|_| path.strip_prefix(root))
        .map(Path::to_path_buf)
        .unwrap_or_else(|_| path.to_path_buf());
    let composed = nfc_string(&relative.to_string_lossy());
    format!("path:{composed}")
}

/// 実体のパス。無いファイルは親を解決して名前を継ぐ
pub(super) fn resolve_existing(path: &Path) -> PathBuf {
    if let Ok(real) = path.canonicalize() {
        return real;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => parent
            .canonicalize()
            .map(|real| real.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

impl Vault {
    /// このノートの履歴の鍵（`history_key` を root 込みで）
    pub fn history_key(&self, path: &Path) -> String {
        history_key(&self.root, path)
    }

    /// 版を残してから書く。**残せなければ書かない** — 開いていないノートの
    /// 旧本文は履歴にしか無い（T7）ので、残せないまま書くと黙って消える。
    /// 「読んで書き戻す」箇所（やることの完了・ピン・追記・改名の見出し・
    /// 一括書き換え・MCP の差し替え・版の復元）は全部ここを通す（21-1。
    /// 以前は 3 か所が eprintln だけで書き進め、5 か所は版を残していなかった）。
    /// 直前の版と同じ中身なら `keep` が黙って飛ばすので二重にはならない
    pub fn write_with_version(
        &self,
        path: &Path,
        before: &str,
        after: &str,
    ) -> std::io::Result<()> {
        let store = crate::history::store_root(&self.managed_dir());
        crate::history::keep(
            &store,
            &self.history_key(path),
            before,
            chrono::Local::now().naive_local(),
            true,
            0,
        )
        .map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("版を残せなかったので書きませんでした: {error}"),
            )
        })?;
        crate::autosave::save_atomic(path, after)
    }

    /// 履歴の置き場を新しいパスへ付け替える。**失敗しても進める** —
    /// 版を連れて行けないことより、動かせないことの方が困る。
    /// **履歴を動かす道はここ 1 本**（改名・移動・ゴミ箱・戻す・フォルダ）
    pub fn carry_history(&self, before: &Path, after: &Path) {
        if before == after {
            return;
        }
        let store = crate::history::store_root(&self.managed_dir());
        if let Err(error) =
            crate::history::rekey(&store, &self.history_key(before), &self.history_key(after))
        {
            eprintln!("履歴の置き場を移せなかった: {error}");
        }
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::temp_vault;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_history_key_実体の綴りやNFDが違っても同じ鍵になる() {
        // 鍵の字面が経路ごとに違っていた（監査 2026-09-17）: `guarded` は
        // canonicalize した実体（/var → /private/var、NFD のまま）、after_folder_moved
        // は scan() の NFC、carry_history は生 root の剥がし。同じノートの版が
        // 経路によって見つからない
        let (root, vault) = temp_vault();
        let nfd = root.path().join("フ\u{309A}.md"); // Finder が作る形
        fs::write(&nfd, "# a\n").unwrap();
        let want = "path:プ.md".to_string();
        assert_eq!(history_key(root.path(), &nfd), want);
        // 実体（/private/var/…）で来ても同じ
        let real_root = root.path().canonicalize().unwrap();
        assert_eq!(history_key(root.path(), &nfd.canonicalize().unwrap()), want);
        assert_eq!(history_key(&real_root, &nfd), want);
        // シンボリックリンクの下から来ても同じ
        let alias = TempDir::new().unwrap();
        let link = alias.path().join("link");
        std::os::unix::fs::symlink(root.path(), &link).unwrap();
        assert_eq!(history_key(&link, &link.join("プ.md")), want);
        // まだ無いファイル（これから書く・戻す先）は親で解決する
        assert_eq!(
            history_key(root.path(), &root.path().join("仕事").join("新しい.md")),
            "path:仕事/新しい.md"
        );
        assert_eq!(vault.history_key(&nfd), want);
    }

    /// 「読んで書き戻す」箇所は全部これを通す（21-1）。版を残してから書く
    #[test]
    fn test_write_with_version_版を残してから書く() {
        let (root, vault) = crate::test_support::temp_vault();
        let note = crate::test_support::note(root.path(), "a.md", "旧\n");
        vault.write_with_version(&note, "旧\n", "新\n").unwrap();
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "新\n");
        let store = crate::history::store_root(&vault.managed_dir());
        let versions = crate::history::versions(&store, &vault.history_key(&note));
        assert_eq!(versions.len(), 1);
        assert_eq!(std::fs::read_to_string(&versions[0].path).unwrap(), "旧\n");
    }

    /// 版を残せなければ**書かない**（T7: 開いていないノートの旧本文は履歴にしか無い）
    #[test]
    fn test_write_with_version_版を残せなければ書かない() {
        let (root, vault) = crate::test_support::temp_vault();
        let note = crate::test_support::note(root.path(), "a.md", "旧\n");
        let _locked = crate::test_support::lock_history(&vault);
        let error = vault.write_with_version(&note, "旧\n", "新\n").unwrap_err();
        assert!(error.to_string().contains("版を残せなかった"), "{error}");
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "旧\n");
    }
}
