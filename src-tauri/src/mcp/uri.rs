// ノートの URI（oboegaki://note/…）と、Claude Desktop に貼る設定の断片。

use std::path::{Path, PathBuf};

/// resource の URI の頭（ADR-0051 の `oboegaki://note/<相対パス>`）
pub const NOTE_URI_PREFIX: &str = "oboegaki://note/";

/// MCP サーバのバイナリの名前（本体の隣に同梱する）
pub const MCP_BINARY: &str = "oboegaki-mcp";

/// 本体（`oboegaki`）の場所から、隣に居る MCP サーバのバイナリを指す。
/// 束ねた `.app` でも `cargo tauri dev` でも同じ並びになる
pub fn binary_next_to(exe: &Path) -> PathBuf {
    exe.parent().unwrap_or(Path::new(".")).join(MCP_BINARY)
}

/// Claude Desktop などに貼る設定の断片（10-6）。**パスを手で打たせない**。
/// serde_json で組む — 空白や引用符を含むパスを自分で埋め込むと壊れる
pub fn config_snippet(binary: &Path, root: &Path) -> String {
    let value = serde_json::json!({
        "mcpServers": {
            "oboegaki": {
                "command": binary.to_string_lossy(),
                "args": [root.to_string_lossy()],
            }
        }
    });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// 相対パスを resource の URI にする。**符号化して渡す** — 空白や `#` を
/// 素で置くと URI として壊れる（日本語は通るが揃えて encode する）
pub fn note_uri(relative: &str) -> String {
    let mut out = String::from(NOTE_URI_PREFIX);
    for byte in relative.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~' | '/') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// URI から相対パスへ戻す。おぼえがきの URI でなければ None。
/// **符号化されていない日本語のまま来ても読む**（そうするクライアントがある）
pub fn path_from_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix(NOTE_URI_PREFIX)?;
    let bytes = rest.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            match u8::from_str_radix(hex, 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                Err(_) => return None,
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
#[allow(non_snake_case)]
mod tests {
    use super::*;

    #[test]
    fn test_note_uri_日本語や空白を往復できる() {
        assert_eq!(
            note_uri("仕事/会 議.md"),
            "oboegaki://note/%E4%BB%95%E4%BA%8B/%E4%BC%9A%20%E8%AD%B0.md"
        );
        assert_eq!(
            path_from_uri("oboegaki://note/%E4%BB%95%E4%BA%8B/%E4%BC%9A%20%E8%AD%B0.md").unwrap(),
            "仕事/会 議.md"
        );
        // 素の日本語で来ても読む（クライアントが符号化しないことがある）
        assert_eq!(
            path_from_uri("oboegaki://note/仕事/会議.md").unwrap(),
            "仕事/会議.md"
        );
        assert!(path_from_uri("file:///etc/passwd").is_none());
    }

    #[test]
    fn test_config_snippet_クライアントに貼る_JSON_を作る() {
        let snippet = config_snippet(
            std::path::Path::new("/Applications/OboeGaki.app/Contents/MacOS/oboegaki-mcp"),
            std::path::Path::new("/Users/だれか/書類/覚 書"),
        );
        // **JSON として読めること**（貼って壊れない）。空白入りのパスも通る
        let parsed: serde_json::Value = serde_json::from_str(&snippet).unwrap();
        let server = &parsed["mcpServers"]["oboegaki"];
        assert_eq!(
            server["command"],
            "/Applications/OboeGaki.app/Contents/MacOS/oboegaki-mcp"
        );
        assert_eq!(server["args"][0], "/Users/だれか/書類/覚 書");
    }

    #[test]
    fn test_binary_next_to_本体の隣の_MCP_を指す() {
        let exe = std::path::Path::new("/Applications/OboeGaki.app/Contents/MacOS/oboegaki");
        assert_eq!(
            binary_next_to(exe),
            std::path::Path::new("/Applications/OboeGaki.app/Contents/MacOS/oboegaki-mcp")
        );
    }
}
