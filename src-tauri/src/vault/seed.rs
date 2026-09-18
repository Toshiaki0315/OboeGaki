// 同梱ノート（使い方・MCP の手引き）の初回配置

use super::*;

impl Vault {
    /// 初回だけ使い方ノートを置く。置いたパスを返す。置かなければ None。
    ///
    /// 条件は「vault が空」かつ「まだ置いたことがない」。印を管理フォルダに
    /// 残すのは、**消したマニュアルを起動のたびに復活させない**ため。
    /// 印は消えてもよい（T7 と同じ扱い。最悪もう一度置かれるだけ）。
    pub fn seed_manual(&self) -> io::Result<Option<PathBuf>> {
        let marker = self.managed_dir().join(MANUAL_MARKER);
        if marker.exists() || !self.is_empty() {
            return Ok(None);
        }
        let placed = self.place_manual()?;
        fs::create_dir_all(self.managed_dir())?;
        fs::write(&marker, placed.to_string_lossy().as_bytes())?;
        Ok(Some(placed))
    }

    /// 使い方ノートを**今の内容で**置く（ヘルプメニューから）。
    ///
    /// アプリが新しくなって説明が増えても、既に置いたノートは古いまま残る
    /// （印があるので `seed_manual` は二度と置かない）。ここから最新の説明を
    /// 出せる道を残しておく。
    ///
    /// **既にあるノートは消さない。** 書き足したメモごと消えては困るので、
    /// 別のファイルとして置く（`unique_path` が名前をずらす）。
    pub fn place_manual(&self) -> io::Result<PathBuf> {
        self.create_with(MANUAL_TITLE, MANUAL)
    }

    /// MCP の手引きを今の内容で置く（ヘルプメニューから）。
    /// 使い方ノートと同じ構え — **既にあるノートは消さず**別に置く
    pub fn place_mcp_manual(&self) -> io::Result<PathBuf> {
        self.create_with(MCP_MANUAL_TITLE, MCP_MANUAL)
    }
}

#[cfg(test)]
// テスト名は日本語で書く。Finder / URL / Shift_JIS のような固有名を
// 小文字に崩さないため、snake_case の警告はこの mod だけ黙らせる
#[allow(non_snake_case)]
mod tests {
    use super::*;
    use crate::test_support::{blank_note, temp_vault};
    use std::fs;

    #[test]
    fn test_seed_manual_空のvaultに一度だけ置く() {
        let (root, vault) = temp_vault();

        let placed = vault.seed_manual().unwrap().unwrap();
        assert_eq!(placed, root.path().join(format!("{MANUAL_TITLE}.md")));
        assert!(fs::read_to_string(&placed).unwrap().starts_with("# "));

        // 消したマニュアルを起動のたびに復活させない
        fs::remove_file(&placed).unwrap();
        assert!(vault.seed_manual().unwrap().is_none());
    }

    #[test]
    fn test_seed_manual_ノートがあるvaultには置かない() {
        let (root, vault) = temp_vault();
        blank_note(root.path(), "先にあるノート.md");

        assert!(vault.seed_manual().unwrap().is_none());
    }

    #[test]
    fn test_mcp_manual_同梱の手引きは題が見出しと揃い_タグを増やさない() {
        // 説明のための `#` でタグ一覧を汚さない（使い方ノートと同じ約束）
        assert_eq!(crate::tags::extract_tags(MCP_MANUAL), Vec::<String>::new());
        assert!(MCP_MANUAL.starts_with(&format!("# {MCP_MANUAL_TITLE}\n")));
    }

    #[test]
    fn test_mcp_manual_貼り方の_3_つの場合を全部書いてある() {
        // 空のとき／mcpServers が既にあるとき／他の設定はあるが mcpServers が無いとき。
        // 3 つ目が抜けていて、外側の `{ }` ごと貼って壊した人がいた（2026-09-18）
        for heading in [
            "### ファイルが空っぽ、または `{}` だけのとき",
            "### 既に `\"mcpServers\"` があるとき",
            "### 他の設定はあるが `\"mcpServers\"` が無いとき",
        ] {
            assert!(MCP_MANUAL.contains(heading), "無い節: {heading}");
        }
    }

    #[test]
    fn test_place_mcp_manual_置いた場所を返し_既にあるノートを消さない() {
        let (root, vault) = temp_vault();
        let first = vault.place_mcp_manual().unwrap();
        assert_eq!(first, root.path().join(format!("{MCP_MANUAL_TITLE}.md")));
        let second = vault.place_mcp_manual().unwrap();
        assert_ne!(first, second);
        assert!(first.is_file() && second.is_file());
    }

    #[test]
    fn test_manual_使い方ノートの題は表示名に合わせる() {
        // 表示名は「おぼえがき」（ADR-0047）。ファイル名・ID 系の
        // `OboeGaki` とは別物で、こちらは人が読む名前
        assert_eq!(MANUAL_TITLE, "おぼえがきの使い方");
    }

    #[test]
    fn test_manual_同梱の使い方ノートはタグを増やさない() {
        // 説明のための `#` は必ずインラインコードに入れる。素で書くと、
        // 置いた人のタグ一覧に説明用の語が並んでしまう
        assert_eq!(crate::tags::extract_tags(MANUAL), Vec::<String>::new());
        assert!(MANUAL.starts_with(&format!("# {MANUAL_TITLE}\n")));
    }

    #[test]
    fn test_place_manual_既にあるノートを消さずに置く() {
        let (_root, vault) = temp_vault();

        let first = vault.place_manual().unwrap();
        fs::write(&first, "# 書き足したメモ\n").unwrap();
        let second = vault.place_manual().unwrap();

        assert_ne!(second, first);
        assert_eq!(fs::read_to_string(&first).unwrap(), "# 書き足したメモ\n");
    }
}
