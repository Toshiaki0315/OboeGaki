import { describe, expect, test } from "vitest";
import { linksRewrittenText } from "./rename-status";

describe("linksRewrittenText", () => {
  test("test_件数と_直せなかった名前を知らせる_何も無ければ空", () => {
    expect(
      linksRewrittenText({ path: "/v/a.md", rewritten: 0, failed: [] }),
    ).toBe("");
    expect(
      linksRewrittenText({ path: "/v/a.md", rewritten: 3, failed: [] }),
    ).toBe("3 件のノートのリンクを直しました");
    expect(
      linksRewrittenText({
        path: "/v/a.md",
        rewritten: 1,
        failed: ["b.md: 読めない"],
      }),
    ).toBe("1 件のノートのリンクを直しました（直せなかった: b.md: 読めない）");
    expect(
      linksRewrittenText({
        path: "/v/a.md",
        rewritten: 0,
        failed: ["b.md: x"],
      }),
    ).toBe("直せなかった: b.md: x");
  });
});
