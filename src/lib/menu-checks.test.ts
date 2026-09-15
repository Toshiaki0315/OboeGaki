// 印つき（✓）メニュー項目の id。Rust（lib.rs の toggle(...)）と同じ見本
// （fixtures/menu-checks.json）を見る — `MenuChecks::apply` は知らない id を
// 黙って飛ばすので、typo すると ✓ が付かないだけで誰も気付かない（15-14）。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { editModeChecks, MENU_CHECK_IDS } from "./menu-checks";

describe("MENU_CHECK_IDS", () => {
  test("test_Rust と同じ見本と一致する", () => {
    const shared: string[] = JSON.parse(
      readFileSync("fixtures/menu-checks.json", "utf8"),
    ).ids;
    expect([...MENU_CHECK_IDS].sort()).toEqual([...shared].sort());
  });
});

describe("editModeChecks（編集モードの上 3 つは排他。要望 2026-09-15）", () => {
  test("test_どちらも切なら_インラインに_✓", () => {
    expect(editModeChecks({ source: false, preview: false })).toEqual({
      "inline-mode": true,
      "source-mode": false,
      "preview-mode": false,
    });
  });

  test("test_必ず_1_つだけ_✓_が付く", () => {
    for (const source of [false, true]) {
      for (const preview of [false, true]) {
        const checks = editModeChecks({ source, preview });
        const on = Object.values(checks).filter(Boolean).length;
        // source と preview が同時に立つ状態は field 側の排他で起きないが、
        // 万一来ても 2 つ ✓ を出さない
        expect(on).toBe(1);
      }
    }
    expect(
      editModeChecks({ source: true, preview: false })["source-mode"],
    ).toBe(true);
    expect(
      editModeChecks({ source: false, preview: true })["preview-mode"],
    ).toBe(true);
  });
});
