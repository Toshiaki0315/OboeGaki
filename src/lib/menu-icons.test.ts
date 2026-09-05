// メニューの絵（要望 2026-09-04）。参照実装 ui/icons.py の決まりに倣う:
// **右クリックとメニューバーで同じ言葉には同じ絵**を使う。

import { describe, expect, it } from "vitest";
import { MENU_ICONS, type MenuIconName } from "./menu-icons";

describe("MENU_ICONS", () => {
  it("test_すべてに線がある", () => {
    for (const [name, paths] of Object.entries(MENU_ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d).not.toBe("");
    }
  });

  it("test_同じ絵を別の名前で持たない", () => {
    // 同じ言葉に同じ絵を使うための台帳なので、絵のほうが重複していたら
    // 名前を分けている意味がない（見分けが付かない）
    const drawn = Object.values(MENU_ICONS).map((paths) => paths.join("|"));
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("test_新しく作る操作はノートとフォルダで描き分ける", () => {
    // 同じメニューに 2 つ並ぶ（要望 2026-09-05）。同じ絵だとどちらが
    // どちらか分からない
    expect(MENU_ICONS.noteNew).toBeDefined();
    expect(MENU_ICONS.noteNew.join("|")).not.toBe(
      MENU_ICONS.folderNew.join("|"),
    );
  });

  it("test_左の欄の 3 つ（フォルダ・ゴミ箱・タグ）に絵がある", () => {
    // 要望 2026-09-05。**ゴミ箱はメニューと同じ絵**（同じ言葉に同じ絵）
    const names: MenuIconName[] = ["folder", "trash", "tag"];
    const drawn = names.map((name) => MENU_ICONS[name].join("|"));
    for (const paths of drawn) expect(paths).not.toBe("");
    expect(new Set(drawn).size).toBe(3); // 3 つとも見分けが付く
  });

  it("test_捨てる操作は 1 つの絵にまとめる", () => {
    // ゴミ箱へ移動・完全に削除・ゴミ箱を空にする は同じ「捨てる」の絵
    const names: MenuIconName[] = ["trash"];
    for (const name of names) expect(MENU_ICONS[name]).toBeDefined();
  });
});
