// コードの色分け HTML（export-code）の検証。

import { describe, expect, test } from "vitest";
import { highlightCodeHtml } from "./export-code";

describe("highlightCodeHtml", () => {
  test("test_引用符もエスケープする（属性に置いても壊れない）", async () => {
    const html = await highlightCodeHtml('const a = "x";', "js");
    expect(html).not.toBeNull();
    expect(html).toContain("&quot;x&quot;");
    expect(html).not.toContain('"x"');
  });

  test("test_知らない言語は null", async () => {
    expect(await highlightCodeHtml("abc", "no-such-language-xyz")).toBeNull();
  });
});
