import { describe, expect, test } from "vitest";
import { renameStatusText } from "./rename-status";

describe("renameStatusText", () => {
  test("test_改名を軸に_リンクの件数と直せなかった名前を添える", () => {
    expect(
      renameStatusText({ path: "/v/定例.md", rewritten: 0, failed: [] }),
    ).toBe("「定例」に改名しました");
    expect(
      renameStatusText({ path: "/v/定例.md", rewritten: 3, failed: [] }),
    ).toBe("「定例」に改名しました（3 件のノートのリンクを直しました）");
    expect(
      renameStatusText({
        path: "/v/定例.md",
        rewritten: 1,
        failed: ["b.md: 読めない"],
      }),
    ).toBe(
      "「定例」に改名しました（1 件のノートのリンクを直しました。直せなかった: b.md: 読めない）",
    );
  });
});
