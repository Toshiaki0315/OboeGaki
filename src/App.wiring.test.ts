// App.tsx の配線の見張り（21-2）。App は 2,400 行の配線で、部品や hook の
// テストの外にある。環境設定の 3 つが**本文の**エディタに渡っていないことを
// 2026-09-06 から見逃していた（参照ペインにだけ渡していた）。丸ごとマウント
// するテストは IPC の差し替えが重いので、ここは字面で見張る（Rust の
// include_str! の自己参照テストと同じ構え）

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

/// `<Editor` から `/>` までの塊を全部取る
function editorBlocks(): string[] {
  return Array.from(source.matchAll(/<Editor\b[\s\S]*?\/>/g), (m) => m[0]);
}

describe("App の配線", () => {
  test("test_本文と参照ペインの_Editor_が_1_つずつある", () => {
    const blocks = editorBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks.filter((b) => b.includes("readOnly"))).toHaveLength(1);
  });

  test("test_環境設定のタブ幅_行番号_字下げコードが本文のエディタにも届く", () => {
    for (const block of editorBlocks()) {
      expect(block).toContain("tabWidth={settings.tabWidth}");
      expect(block).toContain("lineNumbers={settings.lineNumbers}");
      expect(block).toContain("indentedCode={settings.indentedCode}");
    }
  });

  test("test_本文のエディタは開いた回数だけで作り直す（設定の変化は Compartment が追う）", () => {
    const body = editorBlocks().find((b) => !b.includes("readOnly")) ?? "";
    expect(body).toContain("key={editorSession}");
  });

  test("test_参照ペインも開いた回数で作り直す（パスだと開き直しで本文が凍る。21-5）", () => {
    const side = editorBlocks().find((b) => b.includes("readOnly")) ?? "";
    expect(side).toContain("key={referenceSession}");
    expect(side).not.toContain("key={reference.path}");
  });

  test("test_開いているノートのやることの完了も文を突き合わせる（レビュー 2026-09-27）", () => {
    const body =
      /async function completeTask\([\s\S]*?\n {2}\}\n/.exec(source)?.[0] ?? "";
    expect(body).toContain("completeMatching(");
    // 行番号だけで印を書き換える道を残さない
    expect(body).not.toContain("setTaskDone(");
  });

  test("test_編集メニューの書式の項目は_すべて_App_が受ける（23-1）", () => {
    const menu = readFileSync(
      new URL("../src-tauri/src/menu.rs", import.meta.url),
      "utf8",
    );
    const ids = Array.from(
      menu.matchAll(/item\("(format-[a-z]+)"/g),
      (m) => m[1],
    );
    // 寄せ（ADR-0069 の決定 5）もメニューに出ている
    expect(ids).toEqual(
      expect.arrayContaining(["format-center", "format-right"]),
    );
    for (const id of ids) {
      expect(source, id).toMatch(
        new RegExp(
          `"${id}": \\(\\) => editorRef\\.current\\?\\.applyFormat\\("${id.slice(7)}"\\)`,
        ),
      );
    }
  });
});
