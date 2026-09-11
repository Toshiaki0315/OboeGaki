// コードの色分け HTML（export-code）の検証。

import { describe, expect, test } from "vitest";
import {
  highlightCodeHtml,
  CODE_RUN_COLORS,
  highlightCodeRuns,
} from "./export-code";

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

// PowerPoint の run 単位の色分け（TASKS 12-12）。HTML と同じ字句の切り方
describe("highlightCodeRuns", () => {
  test("test_字句ごとの run と_行末の改行の印", async () => {
    const runs = await highlightCodeRuns("const x = 1;\nfoo()", "js");
    expect(runs).not.toBeNull();
    const texts = runs!.map((run) => run.text).join("");
    expect(texts).toBe("const x = 1;foo()"); // 改行は文字ではなく印で持つ
    expect(
      runs!.some((run) => run.text === "const" && run.cls === "tok-keyword"),
    ).toBe(true);
    expect(
      runs!.some((run) => run.text === "1" && run.cls === "tok-number"),
    ).toBe(true);
    // 1 行目の最後の run に改行の印
    const firstLineEnd = runs!.findIndex((run) => run.breakLine);
    expect(firstLineEnd).toBeGreaterThanOrEqual(0);
    expect(
      runs!
        .slice(0, firstLineEnd + 1)
        .map((r) => r.text)
        .join(""),
    ).toBe("const x = 1;");
  });
  test("test_知らない言語は null_色は明るい地で読める組", async () => {
    expect(await highlightCodeRuns("x", "no-such-lang")).toBeNull();
    for (const hex of Object.values(CODE_RUN_COLORS)) {
      expect(hex).toMatch(/^[0-9A-F]{6}$/);
    }
  });
});
