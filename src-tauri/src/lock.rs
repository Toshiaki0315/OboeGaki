// 施錠付きノートの暗号の芯（TASKS 13-1 / ADR-0062）。純 Rust で、ファイルにも画面にも触らない。
//
// ファイル（`.md.enc`）は 1 つで完結させる（ADR-0062 の「形」）。鍵の控えの別ファイルを
// 持つと、消したときに全部が読めなくなる「捨てられないもの」が増える（T7）:
//
// | 位置 | 長さ | 中身 |
// | --- | --- | --- |
// | 0 | 8 | magic `OBOELOCK` |
// | 8 | 1 | 版（1） |
// | 9 | 12 | Argon2id の設定（m_cost KiB・t_cost・p_cost。各 u32 LE） |
// | 21 | 16 | salt |
// | 37 | 24 | nonce |
// | 61 | … | XChaCha20-Poly1305 の暗号文（末尾 16 バイトが認証タグ） |
//
// 頭（0〜61）は認証付きの追加データ（AAD）に入れる — 設定や salt を書き換えられたら
// 開けない。鍵は Argon2id(パスワード, salt) で作り、`Key` が持つ間だけメモリにある
// （落とすと 0 で塗る）。

use argon2::{Algorithm, Argon2, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"OBOELOCK";
const VERSION: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const PARAMS_AT: usize = 9;
const SALT_AT: usize = PARAMS_AT + 12;
const NONCE_AT: usize = SALT_AT + SALT_LEN;
/// 頭の長さ（ここまでが AAD）
pub const HEADER_LEN: usize = NONCE_AT + NONCE_LEN;
/// 認証タグの長さ
const TAG_LEN: usize = 16;

/// 施錠に失敗・開封に失敗した理由
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockError {
    /// 施錠ノートの形ではない（magic が違う）
    NotLocked,
    /// 途中で切れている
    Truncated,
    /// 知らない版（新しいおぼえがきで施錠したもの）
    UnknownVersion(u8),
    /// パスワードが違う（または中身が書き換えられた。認証タグで見分けられない）
    WrongPassword,
    /// 解錠中の鍵とは別の salt で施錠されたファイル（別の保管フォルダから来たなど）
    OtherKey,
    /// 頭の設定がありえない・開いた中身が UTF-8 でない
    Corrupt,
    EmptyPassword,
    /// 乱数や鍵の導出が使えなかった（OS の不具合）
    System(String),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::NotLocked => "施錠したノートではありません".to_string(),
            Self::Truncated => "施錠したノートが途中で切れています".to_string(),
            Self::UnknownVersion(version) => format!(
                "新しいおぼえがきで施錠したノートです（版 {version}）。おぼえがきを新しくしてください"
            ),
            Self::WrongPassword => "パスワードが違います（またはファイルが壊れています）".to_string(),
            Self::OtherKey => {
                "別のパスワードで施錠したノートです（別の保管フォルダから来たものかもしれません）"
                    .to_string()
            }
            Self::Corrupt => "施錠したノートが壊れています".to_string(),
            Self::EmptyPassword => "パスワードが空です".to_string(),
            Self::System(reason) => format!("暗号の処理に失敗しました: {reason}"),
        };
        f.write_str(&text)
    }
}

/// Argon2id の重さ
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Params {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Params {
    /// 本番（64 MiB・3 回・1 並列。Apple Silicon で 1 回約 80ms = 2026-10-05 実測）。
    /// OWASP の下限（19 MiB・2 回）より重い。ノートを開くたびではなく解錠のときだけ払う
    pub const DEFAULT: Params = Params {
        m_cost_kib: 64 * 1024,
        t_cost: 3,
        p_cost: 1,
    };
    /// テスト用（軽い）
    #[cfg(test)]
    pub const FOR_TESTS: Params = Params {
        m_cost_kib: 64,
        t_cost: 1,
        p_cost: 1,
    };

    /// 細工したファイルで重さを吊り上げられないよう、読むときに見る上限
    fn plausible(&self) -> bool {
        (8..=1024 * 1024).contains(&self.m_cost_kib)
            && (1..=16).contains(&self.t_cost)
            && (1..=8).contains(&self.p_cost)
            && self.m_cost_kib >= 8 * self.p_cost
    }

    fn to_bytes(self) -> [u8; 12] {
        let mut bytes = [0u8; 12];
        bytes[0..4].copy_from_slice(&self.m_cost_kib.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.t_cost.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.p_cost.to_le_bytes());
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Params {
        let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap_or([0; 4]));
        Params {
            m_cost_kib: word(0),
            t_cost: word(4),
            p_cost: word(8),
        }
    }
}

// 本番の設定は OWASP の下限（Argon2id: m ≥ 19 MiB・t ≥ 2。Password Storage Cheat Sheet）
// より重いこと。軽くしたら組めなくする
const _: () = assert!(Params::DEFAULT.m_cost_kib >= 19 * 1024 && Params::DEFAULT.t_cost >= 2);

/// パスワードから作った鍵。**落とすと 0 で塗る**（Zeroizing）。salt と設定は封入の頭に書く
pub struct Key {
    bytes: Zeroizing<[u8; 32]>,
    salt: [u8; SALT_LEN],
    params: Params,
}

impl Key {
    /// 新しい salt で鍵を作る（保管フォルダで最初の施錠）
    pub fn create(password: &str, params: Params) -> Result<Key, LockError> {
        let mut salt = [0u8; SALT_LEN];
        getrandom::fill(&mut salt).map_err(|error| LockError::System(error.to_string()))?;
        Self::derive(password, salt, params)
    }

    /// 施錠ノートの頭の salt と設定で鍵を作る（既にある施錠ノートに合わせる）
    pub fn for_file(password: &str, sealed: &[u8]) -> Result<Key, LockError> {
        let (params, salt) = header(sealed)?;
        Self::derive(password, salt, params)
    }

    pub fn salt(&self) -> [u8; SALT_LEN] {
        self.salt
    }

    fn derive(password: &str, salt: [u8; SALT_LEN], params: Params) -> Result<Key, LockError> {
        if password.is_empty() {
            return Err(LockError::EmptyPassword);
        }
        let argon = Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            argon2::Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(32))
                .map_err(|_| LockError::Corrupt)?,
        );
        let mut bytes = Zeroizing::new([0u8; 32]);
        argon
            .hash_password_into(password.as_bytes(), &salt, bytes.as_mut())
            .map_err(|error| LockError::System(error.to_string()))?;
        Ok(Key {
            bytes,
            salt,
            params,
        })
    }

    fn cipher(&self) -> Result<XChaCha20Poly1305, LockError> {
        // 32 バイトなので失敗しない。長さを確かめて読む道で、鍵を写さずに渡す
        XChaCha20Poly1305::new_from_slice(self.bytes.as_ref())
            .map_err(|error| LockError::System(error.to_string()))
    }
}

/// 施錠ノートの形か（頭の magic で見る。中は開かない）
pub fn is_locked(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

/// 頭を読む: 設定と salt。版と設定の妥当さまで見る
fn header(sealed: &[u8]) -> Result<(Params, [u8; SALT_LEN]), LockError> {
    if !is_locked(sealed) {
        return Err(LockError::NotLocked);
    }
    if sealed.len() < HEADER_LEN {
        return Err(LockError::Truncated);
    }
    if sealed[8] != VERSION {
        return Err(LockError::UnknownVersion(sealed[8]));
    }
    let params = Params::from_bytes(&sealed[PARAMS_AT..SALT_AT]);
    if !params.plausible() {
        return Err(LockError::Corrupt);
    }
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&sealed[SALT_AT..NONCE_AT]);
    Ok((params, salt))
}

/// 本文を施錠したバイト列にする（毎回新しい nonce）
pub fn seal(key: &Key, text: &str) -> Result<Vec<u8>, LockError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|error| LockError::System(error.to_string()))?;
    let mut out = Vec::with_capacity(HEADER_LEN + text.len() + TAG_LEN);
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&key.params.to_bytes());
    out.extend_from_slice(&key.salt);
    out.extend_from_slice(&nonce);
    let sealed = key
        .cipher()?
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: text.as_bytes(),
                aad: &out,
            },
        )
        .map_err(|error| LockError::System(error.to_string()))?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// 施錠したバイト列を本文に戻す
pub fn open(key: &Key, sealed: &[u8]) -> Result<String, LockError> {
    let (params, salt) = header(sealed)?;
    if sealed.len() < HEADER_LEN + TAG_LEN {
        return Err(LockError::Truncated);
    }
    if salt != key.salt || params != key.params {
        return Err(LockError::OtherKey);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&sealed[NONCE_AT..HEADER_LEN]);
    let plain = Zeroizing::new(
        key.cipher()?
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &sealed[HEADER_LEN..],
                    aad: &sealed[..HEADER_LEN],
                },
            )
            .map_err(|_| LockError::WrongPassword)?,
    );
    String::from_utf8(plain.to_vec()).map_err(|_| LockError::Corrupt)
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    /// テストでは軽い設定で鍵を作る（本番の設定は 64 MiB を確保する）
    fn key(password: &str) -> Key {
        Key::create(password, Params::FOR_TESTS).unwrap()
    }

    #[test]
    fn test_封入して開封すると元に戻る() {
        let key = key("合言葉");
        let sealed = seal(&key, "# 秘密\n\n日本語の本文 🔒\n").unwrap();
        assert_eq!(open(&key, &sealed).unwrap(), "# 秘密\n\n日本語の本文 🔒\n");
        assert!(is_locked(&sealed));
        // 本文の字は暗号文に出てこない
        assert!(!sealed.windows(6).any(|w| w == "秘密".as_bytes()));
    }

    #[test]
    fn test_同じ鍵でも封入するたびに違うバイトになる() {
        // nonce を毎回作る。同じ nonce を使い回すと鍵ごと破れる
        let key = key("合言葉");
        assert_ne!(seal(&key, "同じ").unwrap(), seal(&key, "同じ").unwrap());
    }

    #[test]
    fn test_ファイルの頭から作った鍵で開ける() {
        // 保管フォルダに 1 つのパスワード: 既にある施錠ノートの salt と設定で鍵を作る
        let sealed = seal(&key("合言葉"), "本文").unwrap();
        let again = Key::for_file("合言葉", &sealed).unwrap();
        assert_eq!(open(&again, &sealed).unwrap(), "本文");
        // 同じ salt の鍵なら、別のノートにも使い回せる
        let other = seal(&again, "別のノート").unwrap();
        assert_eq!(
            Key::for_file("合言葉", &other).unwrap().salt(),
            again.salt()
        );
    }

    #[test]
    fn test_違うパスワードでは開けない() {
        let sealed = seal(&key("合言葉"), "本文").unwrap();
        let wrong = Key::for_file("ちがう", &sealed).unwrap();
        assert_eq!(open(&wrong, &sealed), Err(LockError::WrongPassword));
    }

    #[test]
    fn test_暗号文や頭を書き換えたら開けない() {
        let key = key("合言葉");
        let sealed = seal(&key, "本文").unwrap();
        let mut body = sealed.clone();
        *body.last_mut().unwrap() ^= 1;
        assert_eq!(open(&key, &body), Err(LockError::WrongPassword));
        // nonce の 1 バイト（頭は AAD に入っている）
        let mut head = sealed.clone();
        head[40] ^= 1;
        assert_eq!(open(&key, &head), Err(LockError::WrongPassword));
    }

    #[test]
    fn test_鍵と違う_salt_のファイルは_違う鍵として断る() {
        // 別の保管フォルダから持ってきた施錠ノート。黙って「パスワード違い」にしない
        let mine = key("合言葉");
        let theirs = seal(&key("合言葉"), "本文").unwrap();
        assert_eq!(open(&mine, &theirs), Err(LockError::OtherKey));
    }

    #[test]
    fn test_施錠ノートでないものと_途中で切れたものは断る() {
        let key = key("合言葉");
        assert_eq!(
            open(&key, "# ただのノート\n".as_bytes()),
            Err(LockError::NotLocked)
        );
        assert!(!is_locked("# ただのノート\n".as_bytes()));
        let sealed = seal(&key, "本文").unwrap();
        assert_eq!(open(&key, &sealed[..50]), Err(LockError::Truncated));
        assert_eq!(
            open(&key, &sealed[..HEADER_LEN + 3]),
            Err(LockError::Truncated)
        );
    }

    #[test]
    fn test_知らない版は断る() {
        let key = key("合言葉");
        let mut sealed = seal(&key, "本文").unwrap();
        sealed[8] = 9;
        assert_eq!(open(&key, &sealed), Err(LockError::UnknownVersion(9)));
        assert_eq!(
            Key::for_file("合言葉", &sealed).err(),
            Some(LockError::UnknownVersion(9))
        );
    }

    #[test]
    fn test_ありえない重さの設定は鍵を作る前に断る() {
        // 細工したファイルで何 GB もの記憶を確保させない
        let mut sealed = seal(&key("合言葉"), "本文").unwrap();
        sealed[9..13].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            Key::for_file("合言葉", &sealed).err(),
            Some(LockError::Corrupt)
        );
    }

    #[test]
    fn test_空のパスワードでは鍵を作らない() {
        assert_eq!(
            Key::create("", Params::FOR_TESTS).err(),
            Some(LockError::EmptyPassword)
        );
    }

    #[test]
    #[ignore = "測るだけ: cargo test --release lock::tests::test_本番の設定 -- --ignored --nocapture"]
    fn test_本番の設定で鍵を作る時間() {
        let started = std::time::Instant::now();
        Key::create("合言葉", Params::DEFAULT).unwrap();
        println!("Argon2id（本番の設定）: {:?}", started.elapsed());
    }
}
