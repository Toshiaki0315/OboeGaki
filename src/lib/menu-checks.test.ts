// 印つき（✓）メニュー項目の id。Rust（lib.rs の toggle(...)）と同じ見本
// （fixtures/menu-checks.json）を見る — `MenuChecks::apply` は知らない id を
// 黙って飛ばすので、typo すると ✓ が付かないだけで誰も気付かない（15-14）。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MENU_CHECK_IDS } from "./menu-checks";

describe("MENU_CHECK_IDS", () => {
  test("test_Rust と同じ見本と一致する", () => {
    const shared: string[] = JSON.parse(
      readFileSync("fixtures/menu-checks.json", "utf8"),
    ).ids;
    expect([...MENU_CHECK_IDS].sort()).toEqual([...shared].sort());
  });
});
