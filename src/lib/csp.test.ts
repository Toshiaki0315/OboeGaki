// Content Security Policy（TASKS 9-1）。tauri.conf.json の csp を読んで、
// 守るべき性質を固定する。本物の効き目は `make app` で組んだ .app でしか
// 見られない（dev は Vite の URL を直接読むので CSP が付かない）。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCsp } from "./csp";

const conf = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
) as { app: { security: { csp: string | null } } };

describe("parseCsp", () => {
  test("test_指示ごとに値の列へ分ける", () => {
    expect(parseCsp("default-src 'self'; img-src 'self' data: blob:")).toEqual(
      new Map([
        ["default-src", ["'self'"]],
        ["img-src", ["'self'", "data:", "blob:"]],
      ]),
    );
  });
  test("test_余分な空白と末尾の ; に寛容", () => {
    expect(parseCsp("  object-src   'none' ;")).toEqual(
      new Map([["object-src", ["'none'"]]]),
    );
  });
});

describe("tauri.conf.json の csp", () => {
  const csp = parseCsp(conf.app.security.csp ?? "");

  test("test_CSP を設定している（null ではない）", () => {
    expect(conf.app.security.csp).toEqual(expect.any(String));
  });

  test("test_スクリプトは自分のものだけ_inline と eval を許さない", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'"]);
  });

  test("test_IPC の相手先を connect-src に書く（Tauri v2 の作法）", () => {
    expect(csp.get("connect-src")).toEqual(
      expect.arrayContaining(["ipc:", "http://ipc.localhost"]),
    );
    // Ollama は Rust 側から繋ぐ。WebView から外へ出る道は開けない
    expect(
      csp
        .get("connect-src")
        ?.some(
          (s) =>
            /^https?:\/\/(?!ipc\.localhost)/.test(s) ||
            s === "https:" ||
            s === "http:",
        ),
    ).toBe(false);
  });

  test("test_スタイルは inline を許す（CodeMirror の style-mod と Mermaid の SVG）", () => {
    expect(csp.get("style-src")).toEqual(
      expect.arrayContaining(["'self'", "'unsafe-inline'"]),
    );
  });

  test("test_画像は自分と data と blob だけ（遠隔は描かない = imageSource と同じ線）", () => {
    expect(csp.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  test("test_フォントは束ねたもの（Temml.woff2）だけ", () => {
    expect(csp.get("font-src")).toEqual(["'self'"]);
  });

  test("test_プラグインと iframe と base の差し替えを閉じる", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
  });

  test("test_pdf.js のワーカーは自分のもの", () => {
    expect(csp.get("worker-src")).toEqual(["'self'"]);
  });
});
