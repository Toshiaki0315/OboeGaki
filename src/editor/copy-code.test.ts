// @vitest-environment jsdom
// コードブロックのコピー（要望 2026-09-06）。印の DOM を試すので jsdom。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { codeBlockAt, CopyCodeWidget } from "./copy-code";
import { LANG } from "./test-utils";

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [LANG],
  });
}

const DOC = `本文

\`\`\`c:main.c
int main() {
  return 0;
}
\`\`\`

あと
`;

describe("codeBlockAt", () => {
  test("test_チルダのフェンスでも_ファイル名の行を帯の先頭にする", () => {
    // ``` 専用の判定だと `~~~ts:a.ts` は「名前なし」になり、live-preview
    // （Lezer の CodeInfo を読む）と帯の先頭がずれて印が本文の右上へ飛ぶ
    // （レビュー 2026-09-14）
    const doc = "前\n\n~~~ts:a.ts\nconst a = 1;\n~~~\n";
    const state = stateOf(doc);
    const found = codeBlockAt(state, doc.indexOf("const"));
    expect(found?.code).toBe("const a = 1;");
    expect(found?.markAt).toBe(state.doc.lineAt(doc.indexOf("~~~ts")).to);
  });

  test("test_四本のフェンスの中の三本は閉じではない", () => {
    const doc = "````md\n```\n中\n```\n````\n";
    const state = stateOf(doc);
    const found = codeBlockAt(state, doc.indexOf("中"));
    expect(found?.code).toBe("```\n中\n```");
  });

  test("test_中に居ればコードだけを返す（記号と言語は入れない）", () => {
    const state = stateOf(DOC);
    const found = codeBlockAt(state, DOC.indexOf("return"));
    expect(found?.code).toBe("int main() {\n  return 0;\n}");
  });

  test("test_開きと閉じの行の上でも同じブロック", () => {
    const state = stateOf(DOC);
    const open = codeBlockAt(state, DOC.indexOf("```c:main.c") + 2);
    const close = codeBlockAt(state, DOC.lastIndexOf("```") + 1);
    expect(open?.code).toBe(close?.code);
    expect(open?.from).toBe(close?.from);
  });

  test("test_ファイル名があるときは開きの行末に置く（帯の中）", () => {
    const state = stateOf(DOC);
    const found = codeBlockAt(state, DOC.indexOf("return"));
    expect(found?.markAt).toBe(
      DOC.indexOf("```c:main.c") + "```c:main.c".length,
    );
  });

  test("test_ファイル名が無いときは中身の 1 行目の行末に置く", () => {
    // **帯の中に置かないと印が浮く。** 開きの行は隠れていて位置の基準に
    // ならず、印が本文の右上に飛んでいた（実機報告 2026-09-13）
    const doc = "前\n\n```\nconst a = 1;\nconst b = 2;\n```\n\n後\n";
    const state = stateOf(doc);
    const found = codeBlockAt(state, doc.indexOf("const a"));
    expect(found?.markAt).toBe(
      doc.indexOf("const a = 1;") + "const a = 1;".length,
    );
  });

  test("test_外なら null", () => {
    const state = stateOf(DOC);
    expect(codeBlockAt(state, DOC.indexOf("本文"))).toBeNull();
    expect(codeBlockAt(state, DOC.indexOf("あと"))).toBeNull();
  });

  test("test_インラインのコードは対象にしない", () => {
    const doc = "文中の `code` です\n";
    expect(codeBlockAt(stateOf(doc), doc.indexOf("code"))).toBeNull();
  });

  test("test_閉じの無いブロックでも、書いたぶんは取れる", () => {
    const doc = "```js\nlet a = 1;\n";
    expect(codeBlockAt(stateOf(doc), doc.indexOf("let"))?.code).toBe(
      "let a = 1;",
    );
  });

  test("test_空のブロックは印を出さない（写すものが無い）", () => {
    const doc = "```\n```\n";
    expect(codeBlockAt(stateOf(doc), doc.indexOf("```") + 1)).toBeNull();
  });
});

describe("CopyCodeWidget", () => {
  /// クリップボードは jsdom に無いので差し替える
  function withClipboard(writeText: () => Promise<void>) {
    const before = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return () =>
      Object.defineProperty(navigator, "clipboard", {
        value: before,
        configurable: true,
      });
  }

  test("test_押すと写して_写せたことを知らせる（要望 2026-09-13）", async () => {
    const written: string[] = [];
    const restore = withClipboard(async () => {
      written.push("ok");
    });
    try {
      const told: boolean[] = [];
      const button = new CopyCodeWidget("const a = 1;", (ok) =>
        told.push(ok),
      ).toDOM();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(written).toEqual(["ok"]);
      expect(told).toEqual([true]);
      expect(button.className).toContain("copied");
    } finally {
      restore();
    }
  });

  test("test_写せなければ_そう知らせる（黙って成功に見せない）", async () => {
    const restore = withClipboard(() => Promise.reject(new Error("no")));
    try {
      const told: boolean[] = [];
      const button = new CopyCodeWidget("x", (ok) => told.push(ok)).toDOM();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(told).toEqual([false]);
    } finally {
      restore();
    }
  });
});
