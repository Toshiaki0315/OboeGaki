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

// ------------------------------------------------------- 投稿と更新（14-3）

const API: &str = "https://qiita.com/api/v2/items";
/// タグの数（Qiita の画面側の決まり。API 文書には無いので送る前にこちらで見る）
const MAX_TAGS: usize = 5;

/// 送るもの（TS の qiitaDraft が整えたもの）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Draft {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
}

/// 既に投稿した記事（front matter の `qiita` と `qiita-updated-at`）
#[derive(Debug, Clone)]
pub struct Known {
    pub id: String,
    /// 前に投稿・更新したときの `updated_at`。手で ID だけ書いたときは無い
    pub updated_at: Option<String>,
}

/// 向こうにある記事
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Remote {
    pub id: String,
    pub url: String,
    pub updated_at: String,
}

/// HTTP の口（テストで差し替える）。答えは（状態, 本文）。繋がらなければ Err
pub trait Http {
    fn request(
        &self,
        method: &str,
        url: &str,
        token: &str,
        body: Option<&str>,
    ) -> Result<(u16, String), String>;
}

/// 投稿する（known が無ければ新規、あれば更新）。
///
/// - 新規は**必ず限定共有**（`private: true`）。公開は Qiita の画面で押す（決定 2）
/// - 更新は `private` を送らない（公開済みを限定共有に戻そうとしない）
/// - 更新の前に今の記事を引き、覚えた `updated_at` と食い違えば止める（14-6。
///   向こうで直したものをこちらの更新で消さない）
pub fn publish(
    http: &dyn Http,
    token: &str,
    draft: &Draft,
    known: Option<&Known>,
) -> Result<Remote, String> {
    let title = draft.title.trim();
    if title.is_empty() {
        return Err("題が空です（本文の先頭に `# 題` を書いてください）".into());
    }
    let tags: Vec<serde_json::Value> = draft
        .tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .map(|name| serde_json::json!({ "name": name, "versions": [] }))
        .collect();
    if tags.is_empty() || tags.len() > MAX_TAGS {
        return Err(format!(
            "タグは 1〜{MAX_TAGS} 個にしてください（今は {} 個）",
            tags.len()
        ));
    }
    let Some(known) = known else {
        let body = serde_json::json!({
            "title": title,
            "body": draft.body,
            "tags": tags,
            "private": true,
            "tweet": false,
        });
        let (status, reply) = http
            .request("POST", API, token, Some(&body.to_string()))
            .map_err(unreachable)?;
        return remote_of(status, &reply, 201);
    };
    if known.id.is_empty() || !known.id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!(
            "front matter の qiita: の値が記事 ID の形ではありません: {}",
            known.id
        ));
    }
    let url = format!("{API}/{}", known.id);
    if let Some(expected) = &known.updated_at {
        let (status, reply) = http
            .request("GET", &url, token, None)
            .map_err(unreachable)?;
        let current = remote_of(status, &reply, 200)?;
        if !same_time(&current.updated_at, expected) {
            return Err(format!(
                "Qiita の側で編集されています（{}）。上書きしないよう止めました。\
                 向こうの内容をこのノートに写してから、もう一度投稿してください",
                current.updated_at
            ));
        }
    }
    let body = serde_json::json!({
        "title": title,
        "body": draft.body,
        "tags": tags,
    });
    let (status, reply) = http
        .request("PATCH", &url, token, Some(&body.to_string()))
        .map_err(unreachable)?;
    remote_of(status, &reply, 200)
}

/// 時刻の字面が違っても同じ瞬間なら同じ（`+09:00` と `Z` など）
fn same_time(a: &str, b: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn unreachable(error: String) -> String {
    format!("Qiita に繋がりませんでした: {error}")
}

/// 答えを記事に読む。期待した状態でなければ、状態ごとに読める言葉にする
fn remote_of(status: u16, reply: &str, expected: u16) -> Result<Remote, String> {
    if status == expected {
        let value: serde_json::Value = serde_json::from_str(reply)
            .map_err(|error| format!("Qiita の答えが読めませんでした: {error}"))?;
        let field = |name: &str| value[name].as_str().map(str::to_string);
        return match (field("id"), field("url"), field("updated_at")) {
            (Some(id), Some(url), Some(updated_at)) => Ok(Remote {
                id,
                url,
                updated_at,
            }),
            _ => Err("Qiita の答えに記事の ID・URL・更新時刻がありません".into()),
        };
    }
    let message = serde_json::from_str::<serde_json::Value>(reply)
        .ok()
        .and_then(|value| value["message"].as_str().map(str::to_string));
    let detail = message.map(|m| format!("（{m}）")).unwrap_or_default();
    Err(match status {
        401 => format!(
            "トークンが違うか、期限が切れています。環境設定の「Qiita」で入れ直してください{detail}"
        ),
        403 => format!(
            "このトークンでは投稿できません。write_qiita を付けて発行したトークンか確かめてください{detail}"
        ),
        404 => format!("Qiita に記事が見つかりません（消されたかもしれません）{detail}"),
        429 => "Qiita の回数の上限（1 時間に 1,000 回）に掛かりました。時間をおいてください"
            .to_string(),
        _ => format!("Qiita が受け付けませんでした（{status}）{detail}"),
    })
}

// ------------------------------------------- front matter との往復（14-4）

/// 記事 ID の front matter のキー
pub const ID_KEY: &str = "qiita";
/// 前に投稿・更新したときの Qiita の `updated_at`（14-6 の楽観ロック）
pub const UPDATED_KEY: &str = "qiita-updated-at";

/// front matter の控え（`qiita:` が無ければ None = 新規）
pub fn known_of(text: &str) -> Option<Known> {
    let id = crate::front_matter::value(text, ID_KEY)?;
    Some(Known {
        id,
        updated_at: crate::front_matter::value(text, UPDATED_KEY),
    })
}

/// 投稿の結果を front matter に書き戻した本文。**投稿という明示の操作の結果として
/// だけ書く**（ADR-0063 案 4）。本文と他の行は触らない
pub fn record(text: &str, remote: &Remote) -> String {
    let with_id = crate::front_matter::with_value(text, ID_KEY, Some(&remote.id));
    crate::front_matter::with_value(&with_id, UPDATED_KEY, Some(&remote.updated_at))
}

/// 本物の HTTP（TLS は macOS の仕組みに任せる。別の暗号の実装を抱えない）
pub struct Ureq {
    agent: ureq::Agent,
}

impl Default for Ureq {
    fn default() -> Self {
        let tls = ureq::tls::TlsConfig::builder()
            .provider(ureq::tls::TlsProvider::NativeTls)
            .build();
        let agent = ureq::Agent::config_builder()
            .tls_config(tls)
            // 4xx / 5xx も答えとして受ける（状態ごとに言葉を変えるため）
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_secs(30)))
            .build()
            .into();
        Self { agent }
    }
}

impl Http for Ureq {
    fn request(
        &self,
        method: &str,
        url: &str,
        token: &str,
        body: Option<&str>,
    ) -> Result<(u16, String), String> {
        let bearer = format!("Bearer {token}");
        let response = match (method, body) {
            ("GET", _) => self.agent.get(url).header("Authorization", &bearer).call(),
            ("POST", Some(body)) => self
                .agent
                .post(url)
                .header("Authorization", &bearer)
                .header("Content-Type", "application/json")
                .send(body),
            ("PATCH", Some(body)) => self
                .agent
                .patch(url)
                .header("Authorization", &bearer)
                .header("Content-Type", "application/json")
                .send(body),
            _ => return Err(format!("使わない注文です: {method}")),
        };
        let mut response = response.map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .read_to_string()
            .map_err(|error| error.to_string())?;
        Ok((status, text))
    }
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

    // ------------------------------------------------ 投稿と更新（14-3 / 14-6）

    /// 受けた注文（方法・URL・トークン・本文）
    type Call = (String, String, String, Option<String>);

    /// 決めた順に答える偽の Qiita。受けた注文を控える
    #[derive(Default)]
    struct FakeHttp {
        replies: std::sync::Mutex<Vec<Result<(u16, String), String>>>,
        calls: std::sync::Mutex<Vec<Call>>,
    }

    impl FakeHttp {
        fn answering(replies: Vec<Result<(u16, String), String>>) -> Self {
            let fake = Self::default();
            *fake.replies.lock().unwrap() = replies.into_iter().rev().collect();
            fake
        }
        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Http for FakeHttp {
        fn request(
            &self,
            method: &str,
            url: &str,
            token: &str,
            body: Option<&str>,
        ) -> Result<(u16, String), String> {
            self.calls.lock().unwrap().push((
                method.into(),
                url.into(),
                token.into(),
                body.map(String::from),
            ));
            self.replies
                .lock()
                .unwrap()
                .pop()
                .unwrap_or_else(|| Err("答えを用意していない".into()))
        }
    }

    const ITEM: &str = r#"{"id":"c686397e4a0f4f11683d","url":"https://qiita.com/me/items/c686397e4a0f4f11683d","updated_at":"2026-10-02T10:00:00+09:00","private":true}"#;

    fn draft(tags: &[&str]) -> Draft {
        Draft {
            title: "設計メモ".into(),
            body: "本文です。\n".into(),
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
        }
    }

    fn json(raw: &Option<String>) -> serde_json::Value {
        serde_json::from_str(raw.as_deref().unwrap()).unwrap()
    }

    #[test]
    fn test_新規は限定共有で_POST_する() {
        let http = FakeHttp::answering(vec![Ok((201, ITEM.into()))]);
        let remote = publish(&http, "tok", &draft(&["Rust", "Tauri"]), None).unwrap();

        assert_eq!(remote.id, "c686397e4a0f4f11683d");
        assert_eq!(
            remote.url,
            "https://qiita.com/me/items/c686397e4a0f4f11683d"
        );
        assert_eq!(remote.updated_at, "2026-10-02T10:00:00+09:00");
        let calls = http.calls();
        assert_eq!(calls.len(), 1);
        let (method, url, token, body) = &calls[0];
        assert_eq!(
            (method.as_str(), url.as_str()),
            ("POST", "https://qiita.com/api/v2/items")
        );
        assert_eq!(token, "tok");
        let body = json(body);
        assert_eq!(body["title"], "設計メモ");
        assert_eq!(body["body"], "本文です。\n");
        // 決定 2: 新規は必ず限定共有。外に出す操作をアプリで完了させない
        assert_eq!(body["private"], true);
        assert_eq!(body["tweet"], false);
        assert_eq!(
            body["tags"],
            serde_json::json!([{"name": "Rust", "versions": []}, {"name": "Tauri", "versions": []}])
        );
    }

    #[test]
    fn test_記事_ID_があれば確かめてから_PATCH_し_公開の状態は送らない() {
        let http = FakeHttp::answering(vec![Ok((200, ITEM.into())), Ok((200, ITEM.into()))]);
        let known = Known {
            id: "c686397e4a0f4f11683d".into(),
            updated_at: Some("2026-10-02T10:00:00+09:00".into()),
        };
        publish(&http, "tok", &draft(&["Rust"]), Some(&known)).unwrap();

        let calls = http.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "GET");
        assert_eq!(
            calls[0].1,
            "https://qiita.com/api/v2/items/c686397e4a0f4f11683d"
        );
        assert_eq!(calls[1].0, "PATCH");
        assert_eq!(
            calls[1].1,
            "https://qiita.com/api/v2/items/c686397e4a0f4f11683d"
        );
        let body = json(&calls[1].3);
        // 決定 2: 公開済みを限定共有に戻そうとしない
        assert!(body.get("private").is_none());
        assert!(body.get("tweet").is_none());
        assert_eq!(body["title"], "設計メモ");
    }

    #[test]
    fn test_向こうで編集されていたら更新しない() {
        // 14-6: 覚えた updated_at と食い違えば、こちらの更新で上書きしない
        let edited = ITEM.replace("2026-10-02T10:00:00", "2026-10-03T08:00:00");
        let http = FakeHttp::answering(vec![Ok((200, edited))]);
        let known = Known {
            id: "c686397e4a0f4f11683d".into(),
            updated_at: Some("2026-10-02T10:00:00+09:00".into()),
        };
        let error = publish(&http, "tok", &draft(&["Rust"]), Some(&known)).unwrap_err();
        assert!(error.contains("Qiita の側で編集"), "{error}");
        assert_eq!(http.calls().len(), 1, "PATCH まで行かない");
    }

    #[test]
    fn test_更新した時刻を覚えていなければ確かめずに更新する() {
        // 記事 ID だけを手で書いた front matter（時刻の控えが無い）
        let http = FakeHttp::answering(vec![Ok((200, ITEM.into()))]);
        let known = Known {
            id: "c686397e4a0f4f11683d".into(),
            updated_at: None,
        };
        publish(&http, "tok", &draft(&["Rust"]), Some(&known)).unwrap();
        let calls = http.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "PATCH");
    }

    #[test]
    fn test_タグは_1_から_5_個でなければ送らない() {
        let http = FakeHttp::default();
        assert!(publish(&http, "tok", &draft(&[]), None)
            .unwrap_err()
            .contains("タグ"));
        let six = ["a", "b", "c", "d", "e", "f"];
        assert!(publish(&http, "tok", &draft(&six), None)
            .unwrap_err()
            .contains("タグ"));
        assert!(http.calls().is_empty());
    }

    #[test]
    fn test_題が空なら送らない() {
        let http = FakeHttp::default();
        let mut empty = draft(&["Rust"]);
        empty.title = "  ".into();
        assert!(publish(&http, "tok", &empty, None).is_err());
        assert!(http.calls().is_empty());
    }

    #[test]
    fn test_失敗はそれぞれ読める言葉にする() {
        let say = |status: u16, body: &str| {
            let http = FakeHttp::answering(vec![Ok((status, body.into()))]);
            publish(&http, "tok", &draft(&["Rust"]), None).unwrap_err()
        };
        assert!(say(401, "{}").contains("トークン"), "401");
        assert!(say(403, "{}").contains("write_qiita"), "403");
        assert!(say(429, "{}").contains("1 時間に 1,000 回"), "429");
        // 向こうの理由（message）はそのまま添える
        let bad = say(
            400,
            r#"{"message":"Tags must be valid","type":"bad_request"}"#,
        );
        assert!(bad.contains("Tags must be valid"), "{bad}");
        assert!(say(500, "壊れた").contains("500"), "500");
        let http = FakeHttp::answering(vec![Err("dns error".into())]);
        let error = publish(&http, "tok", &draft(&["Rust"]), None).unwrap_err();
        assert!(error.contains("繋がりません"), "{error}");
    }

    #[test]
    fn test_更新する記事が無ければそう言う() {
        let http = FakeHttp::answering(vec![Ok((
            404,
            r#"{"message":"Not found","type":"not_found"}"#.into(),
        ))]);
        let known = Known {
            id: "gone".into(),
            updated_at: Some("2026-10-02T10:00:00+09:00".into()),
        };
        let error = publish(&http, "tok", &draft(&["Rust"]), Some(&known)).unwrap_err();
        assert!(error.contains("見つかりません"), "{error}");
    }

    #[test]
    fn test_記事_ID_は_URL_に使える字だけ受ける() {
        // front matter は手で書ける。`../` などで別の API を叩かせない
        let http = FakeHttp::default();
        let known = Known {
            id: "../users/me".into(),
            updated_at: None,
        };
        assert!(publish(&http, "tok", &draft(&["Rust"]), Some(&known)).is_err());
        assert!(http.calls().is_empty());
    }

    #[test]
    #[ignore = "外へ繋ぐ。手で回す: cargo test qiita::tests::test_本物 -- --ignored"]
    fn test_本物の_Qiita_に_TLS_で繋がる() {
        // 読むだけ・投稿しない。でたらめのトークンで無い記事を引き、
        // 状態が返ってくること（= TLS と HTTP が通ること）だけを見る
        let (status, _) = Ureq::default()
            .request(
                "GET",
                &format!("{API}/0000000000000000000a"),
                "invalid",
                None,
            )
            .unwrap();
        assert!(matches!(status, 401 | 403 | 404), "{status}");
    }

    // ------------------------------------------- front matter との往復（14-4）

    #[test]
    fn test_front_matter_から記事の控えを読む() {
        let doc =
            "---\nqiita: abc123\nqiita-updated-at: \"2026-10-02T10:00:00+09:00\"\n---\n# 題\n";
        let known = known_of(doc).unwrap();
        assert_eq!(known.id, "abc123");
        assert_eq!(
            known.updated_at.as_deref(),
            Some("2026-10-02T10:00:00+09:00")
        );
        assert!(known_of("# 題\n").is_none());
    }

    #[test]
    fn test_投稿したら記事_ID_と更新時刻を書き戻し_本文は触らない() {
        let remote = Remote {
            id: "abc123".into(),
            url: "https://qiita.com/me/items/abc123".into(),
            updated_at: "2026-10-02T10:00:00+09:00".into(),
        };
        let doc = "---\npinned: true\n---\n# 題\n\n本文\n";
        let recorded = record(doc, &remote);
        assert_eq!(
            recorded,
            "---\npinned: true\nqiita: abc123\nqiita-updated-at: \"2026-10-02T10:00:00+09:00\"\n---\n# 題\n\n本文\n"
        );
        // 読み直すと同じ控え（次は更新になる）
        let known = known_of(&recorded).unwrap();
        assert_eq!(known.id, "abc123");
        assert_eq!(
            known.updated_at.as_deref(),
            Some("2026-10-02T10:00:00+09:00")
        );
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
