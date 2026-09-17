// HTML の逃がし（export-html と export-code が同文で 2 つ持っていた。17-6）
import { describe, expect, test } from "vitest";
import { escapeHtml } from "./html-escape";

describe("escapeHtml", () => {
  test("test_5_文字を逃がす（属性値の中でも安全）", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    expect(escapeHtml("日本語はそのまま")).toBe("日本語はそのまま");
  });
});
