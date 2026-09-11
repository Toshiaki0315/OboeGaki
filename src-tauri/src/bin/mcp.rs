// おぼえがきの MCP サーバ（ADR-0051、TASKS 第 10 群）。stdio で繋ぐ。
//
//     oboegaki-mcp <保管フォルダ>
//
// 中身は lib の `mcp` モジュール（純 Rust。ここは rmcp との橋渡しだけ）。
// 読みのツールだけ（10-2）。書きは 10-4 以降。

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::stdio,
    ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::Deserialize;

use oboegaki_lib::mcp::McpVault;

#[derive(Deserialize, JsonSchema)]
struct SearchParams {
    /// 検索の字。本文と同じ書き方（`#タグ`、`after:2026-09-01`、`before:` も使える）
    /// / Search text. Same syntax as the app (supports `#tag`, `after:`, `before:`).
    query: String,
}

#[derive(Deserialize, JsonSchema)]
struct ReadParams {
    /// 保管フォルダからの相対パス（search_notes / list_notes が返す `path`）
    /// / Path relative to the vault root, as returned by search_notes / list_notes.
    path: String,
}

#[derive(Deserialize, JsonSchema, Default)]
struct ListParams {
    /// フォルダ（相対。空文字は直下。省くと全部）/ Folder relative to the vault root; "" for root; omit for all.
    folder: Option<String>,
    /// タグ（`#` 無し。配下のタグも含む）/ Tag without `#`; includes child tags.
    tag: Option<String>,
}

#[derive(Clone)]
struct OboegakiMcp {
    vault: Arc<McpVault>,
    tool_router: ToolRouter<Self>,
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

#[tool_router]
impl OboegakiMcp {
    fn new(vault: McpVault) -> Self {
        Self {
            vault: Arc::new(vault),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        name = "search_notes",
        description = "ノートを全文検索する（題名・パス・本文。`#タグ` / `after:` / `before:` で絞れる）。結果は path・title・snippet / Full-text search over notes; returns path, title, snippet."
    )]
    async fn search_notes(&self, Parameters(p): Parameters<SearchParams>) -> String {
        match self.vault.search(&p.query) {
            Ok(hits) => json(&hits),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "read_note",
        description = "ノートの本文（front matter 込み）と更新時刻を返す。長い本文は先頭だけ / Read a note's full Markdown text and mtime. Long notes are truncated."
    )]
    async fn read_note(&self, Parameters(p): Parameters<ReadParams>) -> String {
        match self.vault.read_note(&p.path) {
            Ok(note) => json(&note),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "list_notes",
        description = "ノートの一覧（題名・冒頭・更新時刻）。folder や tag で絞れる / List notes with title, preview and mtime; filter by folder and/or tag."
    )]
    async fn list_notes(&self, Parameters(p): Parameters<ListParams>) -> String {
        match self.vault.list_notes(p.folder.as_deref(), p.tag.as_deref()) {
            Ok(rows) => json(&rows),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "list_folders",
        description = "フォルダの一覧と直下のノート数 / List folders with the number of notes directly inside."
    )]
    async fn list_folders(&self) -> String {
        match self.vault.list_folders() {
            Ok(rows) => json(&rows),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "list_tags",
        description = "タグの一覧と使われている数 / List tags with usage counts."
    )]
    async fn list_tags(&self) -> String {
        match self.vault.list_tags() {
            Ok(rows) => json(&rows),
            Err(error) => format!("error: {error}"),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for OboegakiMcp {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new("oboegaki-mcp", env!("CARGO_PKG_VERSION"));
        info.with_instructions(format!(
                "おぼえがき（OboeGaki）の保管フォルダ {} を読む。`.mcp-ignore` に書かれたフォルダは見えない。\
                 / Read-only access to an OboeGaki vault. Folders listed in .mcp-ignore are hidden.",
                self.vault.root().display()
            ))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root: PathBuf = match std::env::args().nth(1) {
        Some(arg) => PathBuf::from(arg),
        None => {
            eprintln!("使い方: oboegaki-mcp <保管フォルダ>");
            std::process::exit(2);
        }
    };
    let vault = McpVault::open(&root).map_err(std::io::Error::other)?;
    let service = OboegakiMcp::new(vault).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
