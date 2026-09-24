import { describe, expect, test } from "vitest";
import { indentWidth } from "./indent";

describe("indentWidth", () => {
  test("test_空白は_1_タブは_4_として数える", () => {
    expect(indentWidth("")).toBe(0);
    expect(indentWidth("  ")).toBe(2);
    expect(indentWidth("\t")).toBe(4);
    expect(indentWidth(" \t ")).toBe(6);
  });
});
