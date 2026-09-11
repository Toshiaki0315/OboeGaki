// おぼえがきの MCP サーバ（ADR-0051、TASKS 第 10 群）。stdio で繋ぐ。
//
//     oboegaki-mcp <保管フォルダ>
//
// 中身は lib の `mcp` モジュール（純 Rust。ここは rmcp との橋渡しだけ）。
// 読みのツールと資源（10-2 / 10-3）と、作る・足すの書き（10-4）。
// 差し替え・移動・ゴミ箱は 10-5 以降。

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        ErrorData as McpError, Implementation, ListResourcesResult, PaginatedRequestParams,
        ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource,
        ResourceContents, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::stdio,
    RoleServer, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::Deserialize;

use oboegaki_lib::mcp::{path_from_uri, McpVault};

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

#[derive(Deserialize, JsonSchema)]
struct RelatedParams {
    /// 起点のノートの相対パス / Path of the note to start from.
    path: String,
    /// 返す件数（既定 8）/ How many notes to return (default 8).
    limit: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
struct HistoryParams {
    /// ノートの相対パス / Path of the note.
    path: String,
    /// 版の時刻（`2026-09-02 10:00:00`）。省くと一覧
    /// / Version stamp as returned by this tool; omit to list versions.
    at: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct CreateParams {
    /// 題名（本文の見出しになる）/ Title; also becomes the note's `#` heading.
    title: String,
    /// 本文（省くと見出しだけ）/ Body text; omit for just the heading.
    text: Option<String>,
    /// 入れるフォルダ（相対。省くと直下）/ Folder to create it in; omit for the vault root.
    folder: Option<String>,
    /// 雛形の名前（`templates/` の中。指定すると text は使わない）
    /// / Template name from the vault's templates folder; `text` is ignored when set.
    template: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct AppendParams {
    /// ノートの相対パス / Path of the note.
    path: String,
    /// 足す文 / Text to append.
    text: String,
    /// 見出し（渡すとその節の末尾へ。省くと文書の末尾）
    /// / Heading to append under; omit to append at the end of the note.
    heading: Option<String>,
}

#[derive(Deserialize, JsonSchema, Default)]
struct DailyParams {
    /// 足す文（省くと今日のノートを作る・開くだけ）/ Text to append; omit to just get today's note.
    text: Option<String>,
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

    #[tool(
        name = "related_notes",
        description = "そのノートに関係するノートを、根拠（指している・同じタグ・題名の出現）ごと強い順に返す / Notes related to the given one, ranked, with the reason each was picked."
    )]
    async fn related_notes(&self, Parameters(p): Parameters<RelatedParams>) -> String {
        match self
            .vault
            .related_notes(&p.path, p.limit.map(|n| n as usize))
        {
            Ok(rows) => json(&rows),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "note_history",
        description = "ノートの版の一覧（新しい順）。at にその時刻を渡すとその版の本文。読むだけで書き戻さない / List a note's saved versions; pass `at` to read one. Read-only."
    )]
    async fn note_history(&self, Parameters(p): Parameters<HistoryParams>) -> String {
        let answer = match p.at.as_deref() {
            Some(stamp) => self
                .vault
                .history_text(&p.path, stamp)
                .map(|note| json(&note)),
            None => self.vault.note_history(&p.path).map(|rows| json(&rows)),
        };
        match answer {
            Ok(text) => text,
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "create_note",
        description = "ノートを新しく作る。題名は本文の見出しになる。folder で入れる場所、template で雛形を選べる / Create a new note; the title becomes its `#` heading."
    )]
    async fn create_note(&self, Parameters(p): Parameters<CreateParams>) -> String {
        match self.vault.create_note(
            &p.title,
            p.text.as_deref(),
            p.folder.as_deref(),
            p.template.as_deref(),
        ) {
            Ok(written) => json(&written),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "append_to_note",
        description = "ノートの末尾に足す。heading を渡すとその節の末尾へ。既にある本文は書き換えない / Append text to a note, optionally at the end of a given heading's section. Existing text is never rewritten."
    )]
    async fn append_to_note(&self, Parameters(p): Parameters<AppendParams>) -> String {
        match self
            .vault
            .append_to_note(&p.path, &p.text, p.heading.as_deref())
        {
            Ok(written) => json(&written),
            Err(error) => format!("error: {error}"),
        }
    }

    #[tool(
        name = "daily_note",
        description = "今日のノートを返す（無ければ作る）。text を渡すと末尾に足す / Today's note, creating it if needed; pass `text` to append to it."
    )]
    async fn daily_note(&self, Parameters(p): Parameters<DailyParams>) -> String {
        match self.vault.daily_note(p.text.as_deref()) {
            Ok(written) => json(&written),
            Err(error) => format!("error: {error}"),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for OboegakiMcp {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        );
        info.server_info = Implementation::new("oboegaki-mcp", env!("CARGO_PKG_VERSION"));
        info.with_instructions(format!(
                "おぼえがき（OboeGaki）の保管フォルダ {} を読み書きする。`.mcp-ignore` に書かれたフォルダは見えず、書き込みもできない。書けるのは新しいノートと末尾への追記だけで、既にある本文は書き換えない。\
                 / Read and write an OboeGaki vault. Folders listed in .mcp-ignore are hidden and read-only. Writing is limited to creating notes and appending; existing text is never rewritten.",
                self.vault.root().display()
            ))
    }

    /// ノートを資源として並べる（10-3）。一覧に出ないものは資源にもしない
    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        let rows = self
            .vault
            .list_resources()
            .map_err(|error| McpError::internal_error(error, None))?;
        Ok(ListResourcesResult::with_all_items(
            rows.into_iter()
                .map(|row| {
                    Resource::new(row.uri, row.path)
                        .with_title(row.title)
                        .with_mime_type("text/markdown")
                })
                .collect(),
        ))
    }

    /// `oboegaki://note/<相対パス>` を読む。**読みの門は read_note と同じ** —
    /// 見せない場所と保管フォルダの外はここでも断られる
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, McpError> {
        let path = path_from_uri(&request.uri).ok_or_else(|| {
            McpError::resource_not_found(format!("知らない URI です: {}", request.uri), None)
        })?;
        let note = self
            .vault
            .read_note(&path)
            .map_err(|error| McpError::resource_not_found(error, None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(note.text, request.uri)]).into())
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
