// コードブロックのコピー（要望 2026-09-06）。

import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { relaxedAsterisk } from "./relaxed-emphasis";
import { extendedInline } from "./extended-inline";
import { codeBlockAt } from "./copy-code";

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [relaxedAsterisk, extendedInline, TaskList, Table],
      }),
    ],
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

  test("test_印を出す場所はブロックの先頭の行末", () => {
    const state = stateOf(DOC);
    const found = codeBlockAt(state, DOC.indexOf("return"));
    expect(found?.markAt).toBe(
      DOC.indexOf("```c:main.c") + "```c:main.c".length,
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
