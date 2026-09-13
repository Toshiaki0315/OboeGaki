// おぼえがきの MCP サーバ（ADR-0051、TASKS 第 10 群）。stdio で繋ぐ。
//
//     oboegaki-mcp <保管フォルダ>
//
// 中身は lib の `mcp` モジュール（純 Rust。ここは rmcp との橋渡しだけ）。
// 読みのツールと資源（10-2 / 10-3）、作る・足す（10-4）、差し替え・移動・
// ゴミ箱（10-5）。**消すのはゴミ箱まで** — 空にする道は作らない。

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolResult, ContentBlock, ErrorData as McpError, Implementation, ListResourcesResult,
        PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse,
        ReadResourceResult, Resource, ResourceContents, ServerCapabilities, ServerInfo,
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

#[derive(Deserialize, JsonSchema)]
struct ReplaceParams {
    /// ノートの相対パス / Path of the note.
    path: String,
    /// 新しい本文（丸ごと差し替える）/ The complete new text; replaces the whole note.
    text: String,
    /// `read_note` で得た `mtime_ms`。違えば断る（**必ず読んでから書く**）
    /// / The `mtime_ms` you got from read_note; the write is refused if it no longer matches.
    expected_mtime_ms: i64,
}

#[derive(Deserialize, JsonSchema)]
struct MoveParams {
    /// ノートの相対パス / Path of the note.
    path: String,
    /// 行き先のフォルダ（相対。空文字で直下）/ Destination folder; "" for the vault root.
    folder: String,
}

#[derive(Clone)]
struct OboegakiMcp {
    vault: Arc<McpVault>,
    tool_router: ToolRouter<Self>,
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

/// 道具の答え。**失敗は `isError` で返す**（レビュー 2026-09-14） — 本文に
/// "error:" と書くだけだと成功応答なので、クライアントが機械的に見分け
/// られず、モデルがノートの中身と読み違える。断った理由は本文に入れる
fn reply(answer: Result<String, String>) -> Result<CallToolResult, McpError> {
    Ok(match answer {
        Ok(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
    })
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
    async fn search_notes(
        &self,
        Parameters(p): Parameters<SearchParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(self.vault.search(&p.query).map(|hits| json(&hits)))
    }

    #[tool(
        name = "read_note",
        description = "ノートの本文（front matter 込み）と更新時刻を返す。長い本文は先頭だけ / Read a note's full Markdown text and mtime. Long notes are truncated."
    )]
    async fn read_note(
        &self,
        Parameters(p): Parameters<ReadParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(self.vault.read_note(&p.path).map(|note| json(&note)))
    }

    #[tool(
        name = "list_notes",
        description = "ノートの一覧（題名・冒頭・更新時刻）。folder や tag で絞れる / List notes with title, preview and mtime; filter by folder and/or tag."
    )]
    async fn list_notes(
        &self,
        Parameters(p): Parameters<ListParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .list_notes(p.folder.as_deref(), p.tag.as_deref())
                .map(|rows| json(&rows)),
        )
    }

    #[tool(
        name = "list_folders",
        description = "フォルダの一覧と直下のノート数 / List folders with the number of notes directly inside."
    )]
    async fn list_folders(&self) -> Result<CallToolResult, McpError> {
        reply(self.vault.list_folders().map(|rows| json(&rows)))
    }

    #[tool(
        name = "list_tags",
        description = "タグの一覧と使われている数 / List tags with usage counts."
    )]
    async fn list_tags(&self) -> Result<CallToolResult, McpError> {
        reply(self.vault.list_tags().map(|rows| json(&rows)))
    }

    #[tool(
        name = "related_notes",
        description = "そのノートに関係するノートを、根拠（指している・同じタグ・題名の出現）ごと強い順に返す / Notes related to the given one, ranked, with the reason each was picked."
    )]
    async fn related_notes(
        &self,
        Parameters(p): Parameters<RelatedParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .related_notes(&p.path, p.limit.map(|n| n as usize))
                .map(|rows| json(&rows)),
        )
    }

    #[tool(
        name = "note_history",
        description = "ノートの版の一覧（新しい順）。at にその時刻を渡すとその版の本文。読むだけで書き戻さない / List a note's saved versions; pass `at` to read one. Read-only."
    )]
    async fn note_history(
        &self,
        Parameters(p): Parameters<HistoryParams>,
    ) -> Result<CallToolResult, McpError> {
        let answer = match p.at.as_deref() {
            Some(stamp) => self
                .vault
                .history_text(&p.path, stamp)
                .map(|note| json(&note)),
            None => self.vault.note_history(&p.path).map(|rows| json(&rows)),
        };
        reply(answer)
    }

    #[tool(
        name = "create_note",
        description = "ノートを新しく作る。題名は本文の見出しになる。folder で入れる場所、template で雛形を選べる / Create a new note; the title becomes its `#` heading."
    )]
    async fn create_note(
        &self,
        Parameters(p): Parameters<CreateParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .create_note(
                    &p.title,
                    p.text.as_deref(),
                    p.folder.as_deref(),
                    p.template.as_deref(),
                )
                .map(|written| json(&written)),
        )
    }

    #[tool(
        name = "append_to_note",
        description = "ノートの末尾に足す。heading を渡すとその節の末尾へ。既にある本文は書き換えない / Append text to a note, optionally at the end of a given heading's section. Existing text is never rewritten."
    )]
    async fn append_to_note(
        &self,
        Parameters(p): Parameters<AppendParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .append_to_note(&p.path, &p.text, p.heading.as_deref())
                .map(|written| json(&written)),
        )
    }

    #[tool(
        name = "replace_note",
        description = "ノートの本文を丸ごと差し替える。read_note で得た mtime_ms が要る（その間に変わっていれば断る）/ Replace a note's whole text. Requires the mtime_ms from read_note; refused if the note changed since."
    )]
    async fn replace_note(
        &self,
        Parameters(p): Parameters<ReplaceParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .replace_note(&p.path, &p.text, p.expected_mtime_ms)
                .map(|written| json(&written)),
        )
    }

    #[tool(
        name = "move_note",
        description = "ノートを別のフォルダへ移す（履歴も連れて行く）/ Move a note to another folder; its history follows."
    )]
    async fn move_note(
        &self,
        Parameters(p): Parameters<MoveParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .move_note(&p.path, &p.folder)
                .map(|written| json(&written)),
        )
    }

    #[tool(
        name = "trash_note",
        description = "ノートをゴミ箱へ移す。**消しはしない**（ゴミ箱を空にする道は無い）。ピン留め中は断る / Move a note to the trash. It is never deleted, and pinned notes are refused."
    )]
    async fn trash_note(
        &self,
        Parameters(p): Parameters<ReadParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(self.vault.trash_note(&p.path).map(|written| json(&written)))
    }

    #[tool(
        name = "daily_note",
        description = "今日のノートを返す（無ければ作る）。text を渡すと末尾に足す / Today's note, creating it if needed; pass `text` to append to it."
    )]
    async fn daily_note(
        &self,
        Parameters(p): Parameters<DailyParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(
            self.vault
                .daily_note(p.text.as_deref())
                .map(|written| json(&written)),
        )
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
                "おぼえがき（OboeGaki）の保管フォルダ {} を読み書きする。`.mcp-ignore` に書かれたフォルダとノートは見えず、書き込みもできない。新しいノートを作る・末尾や節の末尾に足す・本文を丸ごと差し替える（read_note で得た更新時刻を添える楽観ロック）・別のフォルダへ移す・ゴミ箱へ入れる（消しはしない）ができる。\
                 / Read and write an OboeGaki vault. Folders and notes listed in .mcp-ignore are hidden and cannot be written. You can create notes, append to the end or to a section, replace a note's whole text (optimistic lock: pass the mtime from read_note), move a note to another folder, and move a note to the trash (never deleted).",
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
