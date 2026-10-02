// Qiita への投稿（TASKS 第 14 群 / ADR-0063）。
//
// **トークンは Keychain に置く**（14-1）。保管フォルダにも設定 JSON にも書かない —
// 保管フォルダは共有・同期されうる（ADR-0052）。**WebView には返さない**: 画面が
// 知るのは「入っているか」だけで、使うのは Rust 側（14-3）。
//
// 置き場は `SecretStore` で差し替える。本番は macOS の Keychain、テストはメモリ
// （cargo test が使う人のログインキーチェーンを触らないように）。

use std::io;

/// トークンの置き場。値を返すのは Rust の中（送るとき）だけ
pub trait SecretStore {
    fn get(&self) -> io::Result<Option<String>>;
    fn set(&self, value: &str) -> io::Result<()>;
    /// 無いものを消しても失敗にしない
    fn clear(&self) -> io::Result<()>;
}

/// Keychain の項目の名前。「キーチェーンアクセス」でこの名前で見える
pub const KEYCHAIN_SERVICE: &str = "おぼえがき — Qiita";
const KEYCHAIN_ACCOUNT: &str = "access-token";
/// 項目が無い（errSecItemNotFound）
const ITEM_NOT_FOUND: i32 = -25300;

/// トークンの字数の上限。Qiita のトークンは 40 字の 16 進。形は向こうが変えうるので
/// 決め打ちせず、明らかな打ち間違い（文の貼り付けなど）だけを断る
pub const MAX_TOKEN_LEN: usize = 256;

/// macOS のログインキーチェーン（汎用パスワードの項目）
pub struct Keychain;

impl SecretStore for Keychain {
    fn get(&self) -> io::Result<Option<String>> {
        match security_framework::passwords::get_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
        ) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| io::Error::other("Keychain の中身が読めませんでした")),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(io::Error::other(error.to_string())),
        }
    }

    fn set(&self, value: &str) -> io::Result<()> {
        security_framework::passwords::set_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
            value.as_bytes(),
        )
        .map_err(|error| io::Error::other(error.to_string()))
    }

    fn clear(&self) -> io::Result<()> {
        match security_framework::passwords::delete_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
        ) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(io::Error::other(error.to_string())),
        }
    }
}

/// テスト用の置き場（メモリ）
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<Option<String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self) -> io::Result<Option<String>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn set(&self, value: &str) -> io::Result<()> {
        *self.0.lock().unwrap() = Some(value.to_string());
        Ok(())
    }
    fn clear(&self) -> io::Result<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

/// トークンを入れる。前後の空白は落とす（コピーで改行が付いてくる）。空・途中の空白・
/// 英数記号でない字・長すぎるものは断り、置き場には触らない
pub fn save_token(store: &dyn SecretStore, raw: &str) -> Result<(), String> {
    let token = raw.trim();
    if token.is_empty() {
        return Err("トークンが空です".into());
    }
    if token.len() > MAX_TOKEN_LEN || !token.chars().all(|c| c.is_ascii_graphic()) {
        return Err(
            "トークンの形ではありません（Qiita の「アクセストークン」を貼り付けてください）".into(),
        );
    }
    store
        .set(token)
        .map_err(|error| format!("Keychain に入れられませんでした: {error}"))
}

/// 入っているか（画面に出すのはこれだけ）。読めなければ入っていない扱い
pub fn token_saved(store: &dyn SecretStore) -> bool {
    matches!(store.get(), Ok(Some(token)) if !token.is_empty())
}

/// トークンを消す
pub fn clear_token(store: &dyn SecretStore) -> Result<(), String> {
    store
        .clear()
        .map_err(|error| format!("Keychain から消せませんでした: {error}"))
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_トークンを入れると入っていることになる() {
        let store = MemoryStore::default();
        assert!(!token_saved(&store));
        save_token(&store, "0123456789abcdef0123456789abcdef01234567").unwrap();
        assert!(token_saved(&store));
        assert_eq!(
            store.get().unwrap().as_deref(),
            Some("0123456789abcdef0123456789abcdef01234567")
        );
    }

    #[test]
    fn test_前後の空白は落として入れる() {
        // コピーで改行が付いてくる
        let store = MemoryStore::default();
        save_token(&store, "  abc123\n").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("abc123"));
    }

    #[test]
    fn test_空や途中に空白のある字は入れない() {
        let store = MemoryStore::default();
        assert!(save_token(&store, "  ").is_err());
        assert!(save_token(&store, "abc def").is_err());
        assert!(save_token(&store, "日本語").is_err());
        assert!(save_token(&store, &"a".repeat(MAX_TOKEN_LEN + 1)).is_err());
        assert!(!token_saved(&store), "断ったものは置かない");
    }

    #[test]
    fn test_消すと入っていないことになる() {
        let store = MemoryStore::default();
        save_token(&store, "abc123").unwrap();
        clear_token(&store).unwrap();
        assert!(!token_saved(&store));
        // 無いものを消しても失敗にしない
        clear_token(&store).unwrap();
    }

    #[test]
    fn test_入れ直すと置き換わる() {
        let store = MemoryStore::default();
        save_token(&store, "first").unwrap();
        save_token(&store, "second").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("second"));
    }

    #[test]
    fn test_読めない置き場は入っていない扱い() {
        assert!(!token_saved(&BrokenStore));
    }

    struct BrokenStore;
    impl SecretStore for BrokenStore {
        fn get(&self) -> io::Result<Option<String>> {
            Err(io::Error::other("壊れている"))
        }
        fn set(&self, _: &str) -> io::Result<()> {
            Err(io::Error::other("壊れている"))
        }
        fn clear(&self) -> io::Result<()> {
            Err(io::Error::other("壊れている"))
        }
    }
}
