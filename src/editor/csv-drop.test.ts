// CSV を落として表にする（要望 2026-09-06）。

import { describe, expect, it } from "vitest";
import { tableBlock } from "./csv-drop";

const TABLE = "| a |\n| --- |\n| 1 |\n";

describe("tableBlock", () => {
  it("test_文の途中なら前に空行を足す", () => {
    expect(tableBlock(TABLE, "本文", "")).toBe(`\n\n${TABLE}`);
  });

  it("test_行頭なら足さない", () => {
    expect(tableBlock(TABLE, "", "")).toBe(TABLE);
    expect(tableBlock(TABLE, "\n\n", "")).toBe(TABLE);
  });

  it("test_改行 1 つのあとなら、もう 1 つだけ足す", () => {
    expect(tableBlock(TABLE, "文\n", "")).toBe(`\n${TABLE}`);
  });

  it("test_後ろに文が続くなら改行を足す", () => {
    expect(tableBlock(TABLE, "", "続き")).toBe(`${TABLE}\n`);
  });

  it("test_表が空なら何も返さない", () => {
    expect(tableBlock("", "本文", "")).toBe("");
  });
});
