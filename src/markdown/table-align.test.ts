import { describe, expect, test } from "vitest";
import { tableAlign } from "./table-align";

describe("tableAlign", () => {
  test("test_コロンの位置で左右中央_無ければ_null", () => {
    expect(tableAlign(":---")).toBe("left");
    expect(tableAlign("---:")).toBe("right");
    expect(tableAlign(" :---: ")).toBe("center");
    expect(tableAlign("---")).toBeNull();
  });
});
