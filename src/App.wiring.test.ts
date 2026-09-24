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
});
