//! MCP サーバのバイナリを**実際に起動して** stdio で 1 往復する（TASKS 15-8）。
//!
//! ここまでは毎回、手で JSON-RPC を打ち込んで確かめていた（10-2 / 10-3 /
//! 10-4 / 10-5 の「stdio の煙試験」）。**手でしか確かめられないものは、
//! いつか確かめなくなる**ので、テストに下ろす。
//!
//! テスト名は日本語（固有名を小文字に崩さない = lib と同じ約束）。
//!
//! 見るのは「バイナリとして繋がるか」だけ — 道具 1 つ 1 つの中身は
//! `mcp` モジュールの単体テストが見ている（同じことを 2 度見ない）。

#![allow(non_snake_case)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// 起動中のサーバ。落とし忘れないよう Drop で殺す
struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    id: i64,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    fn start(root: &std::path::Path) -> Self {
        // cargo が同じ profile で組んだバイナリ（テストの隣）を使う
        let exe = std::path::Path::new(env!("CARGO_BIN_EXE_oboegaki-mcp"));
        let mut child = Command::new(exe)
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("oboegaki-mcp を起動できない");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        let mut server = Server {
            child,
            stdin,
            stdout,
            id: 0,
        };
        server.handshake();
        server
    }

    fn send(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("書けない");
        self.stdin.flush().expect("流せない");
    }

    fn recv(&mut self) -> serde_json::Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("返事が来ない");
        serde_json::from_str(&line).expect("JSON ではない")
    }

    fn request(&mut self, method: &str, params: serde_json::Value) -> serde_json::Value {
        self.id += 1;
        let call = serde_json::json!({
            "jsonrpc": "2.0", "id": self.id, "method": method, "params": params,
        });
        self.send(&call.to_string());
        self.recv()
    }

    fn handshake(&mut self) {
        let hello = self.request(
            "initialize",
            serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" },
            }),
        );
        assert_eq!(hello["result"]["serverInfo"]["name"], "oboegaki-mcp");
        self.send(
            &serde_json::json!({
                "jsonrpc": "2.0", "method": "notifications/initialized",
            })
            .to_string(),
        );
    }

    /// 道具を呼んで、返ってきた本文（JSON の文字列）を返す
    fn call(&mut self, name: &str, args: serde_json::Value) -> String {
        let answer = self.request(
            "tools/call",
            serde_json::json!({ "name": name, "arguments": args }),
        );
        answer["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }
}

fn vault() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("会議メモ.md"),
        "# 会議メモ\n\n決めたこと #仕事\n",
    )
    .unwrap();
    std::fs::create_dir_all(dir.path().join("秘密")).unwrap();
    std::fs::write(dir.path().join("秘密/裏.md"), "# 裏\n\n決めたこと\n").unwrap();
    std::fs::write(dir.path().join(".mcp-ignore"), "秘密\n").unwrap();
    dir
}

#[test]
fn 繋がって道具が並ぶ() {
    let dir = vault();
    let mut server = Server::start(dir.path());
    let listed = server.request("tools/list", serde_json::json!({}));
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    // 読み（10-2 / 10-3）と書き（10-4 / 10-5）が揃っていること
    for wanted in [
        "search_notes",
        "read_note",
        "list_notes",
        "list_folders",
        "list_tags",
        "related_notes",
        "note_history",
        "create_note",
        "append_to_note",
        "daily_note",
        "replace_note",
        "move_note",
        "trash_note",
    ] {
        assert!(names.contains(&wanted), "{wanted} が無い: {names:?}");
    }
}

#[test]
fn 資源として並び_見せない場所は断る() {
    let dir = vault();
    let mut server = Server::start(dir.path());
    let listed = server.request("resources/list", serde_json::json!({}));
    let resources = listed["result"]["resources"].as_array().unwrap();
    assert!(resources.iter().any(|r| r["name"] == "会議メモ.md"));
    assert!(!resources.iter().any(|r| r["name"] == "秘密/裏.md"));

    let uri = resources
        .iter()
        .find(|r| r["name"] == "会議メモ.md")
        .unwrap()["uri"]
        .as_str()
        .unwrap()
        .to_string();
    let read = server.request("resources/read", serde_json::json!({ "uri": uri }));
    assert!(read["result"]["contents"][0]["text"]
        .as_str()
        .unwrap()
        .contains("決めたこと"));

    // `.mcp-ignore` の中は資源としても読めない
    let denied = server.request(
        "resources/read",
        serde_json::json!({ "uri": "oboegaki://note/%E7%A7%98%E5%AF%86/%E8%A3%8F.md" }),
    );
    assert!(denied["error"].is_object(), "断られていない: {denied}");
}

#[test]
fn 読んで書いて_見せない場所は断る() {
    let dir = vault();
    let mut server = Server::start(dir.path());
    // 読み: 見せない場所は検索に出ない
    let hits = server.call("search_notes", serde_json::json!({ "query": "決めたこと" }));
    assert!(hits.contains("会議メモ.md"), "{hits}");
    assert!(!hits.contains("秘密/"), "{hits}");

    // 書き: 作って、足して、差し替える（楽観ロックまで）
    let made = server.call(
        "create_note",
        serde_json::json!({ "title": "覚え書き", "text": "本文" }),
    );
    assert!(made.contains("覚え書き.md"), "{made}");
    server.call(
        "append_to_note",
        serde_json::json!({ "path": "覚え書き.md", "text": "足した行" }),
    );
    let note: serde_json::Value = serde_json::from_str(
        &server.call("read_note", serde_json::json!({ "path": "覚え書き.md" })),
    )
    .unwrap();
    assert!(note["text"].as_str().unwrap().contains("足した行"));

    let stale = server.call(
        "replace_note",
        serde_json::json!({
            "path": "覚え書き.md", "text": "# 覚え書き\n\nだめ\n",
            "expected_mtime_ms": note["mtime_ms"].as_i64().unwrap() - 1000,
        }),
    );
    assert!(stale.starts_with("error:"), "古い時刻が通った: {stale}");

    // 見せない場所へは書けない
    let denied = server.call(
        "create_note",
        serde_json::json!({ "title": "裏", "folder": "秘密" }),
    );
    assert!(denied.starts_with("error:"), "{denied}");
}
